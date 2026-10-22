import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Rol } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { esSqlstate } from '../errores/sqlstate';
import { CorreosCuenta } from '../notificaciones/correos-cuenta';
import type { DesafioSegundoFactor, Tokens } from './auth.dto';
import { enmascararCorreo, esCodigoRespaldo, ESPERA_REENVIO_SEGUNDOS, hashCodigo, nuevoCodigoCorreo, nuevosCodigosRespaldo } from './segundo-factor';
import { HORA, hashToken, nuevoTokenCorreo } from './tokens-correo';
import { nuevoSecretoTotp, uriTotp, verificarTotp } from './totp';

interface Credenciales {
  id: string;
  password_hash: string | null;
  rol: Rol;
  activo: boolean;
  fecha_expiracion_acceso: Date | null;
}

const NO_AUTORIZADO = 'Credenciales invalidas o cuenta sin acceso';
const COSTO_BCRYPT = 12;
/** Cubre los 10 minutos del codigo por correo y un reenvio. */
const DESAFIO_MINUTOS = 15;
const CODIGO_INVALIDO = 'El código no es válido o venció. Puedes pedir uno nuevo.';
type Metodo = DesafioSegundoFactor['metodo'];

/**
 * Login y sesiones. Corre sin contexto RLS (funciones de login y sesiones,
 * diseñadas para eso).
 *
 * Diseño del refresh token (tabla sesiones, migracion 20261012000000):
 * - Opaco (32 bytes aleatorios); la BD guarda solo su SHA-256.
 * - Rotacion: cada refresh entrega uno nuevo y marca el anterior usado.
 * - Reuso de un token usado o revocado = robo probable: se revoca la familia.
 * - Revocacion: logout (familia), y en la BD un trigger revoca todas las
 *   sesiones del usuario al cambiar rol, activo, contraseña o cierre.
 * - El access token (JWT HS256, JWT_ACCESO_MINUTOS) no se revoca, pero cada
 *   request verifica acceso_vigente() en su transaccion.
 *
 * 03a: una cuenta puede tener dos roles (ADMIN o GESTION + PROFESIONAL); la
 * sesion trabaja con uno (rol del JWT = app.current_rol) y se cambia sin
 * cerrar sesion (cambiar_rol_sesion: token nuevo). Recuperacion, acceso por
 * enlace (pacientes) e invitaciones: tokens de un solo uso por correo
 * (tokens_correo).
 *
 * 03b-4.1: segundo factor por correo, obligatorio para todo el equipo y
 * opcional para pacientes y responsables; la primera verificacion entrega 10
 * codigos de respaldo. El TOTP de 03a queda tras TOTP_HABILITADO (apagado):
 * sus rutas responden 404 y el login nunca lo pide.
 */
@Injectable()
export class AuthService {
  /** Hash de relleno: el tiempo de respuesta no revela si el email existe. */
  private readonly hashRelleno = bcrypt.hashSync('relleno-sin-usuario', 10);

  constructor(
    private readonly bd: ContextoBd,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
  ) {}

  /**
   * Correo o RUT (03b-4.1: paciente, adulto responsable o integrante del
   * equipo con RUT registrado). Un RUT puede tener dos cuentas (la misma
   * persona paciente y del equipo): entra la que coincide con la contraseña.
   * Mismo mensaje en todo caso de error.
   */
  async login(identificador: { email?: string; rut?: string }, password: string, rolPedido?: Rol): Promise<Tokens | DesafioSegundoFactor> {
    const db = this.bd.sinContexto('login');
    const filas = identificador.rut
      ? await db.$queryRaw<Credenciales[]>`
          SELECT id::text, password_hash, rol, activo, fecha_expiracion_acceso
          FROM credenciales_login_rut(${Buffer.from(this.llavero.hmacRut(identificador.rut))})`
      : await db.$queryRaw<Credenciales[]>`
          SELECT id::text, password_hash, rol, activo, fecha_expiracion_acceso FROM credenciales_login(${identificador.email ?? ''})`;
    let fila: Credenciales | undefined;
    for (const f of filas.length ? filas : [undefined]) {
      if ((await bcrypt.compare(password, f?.password_hash ?? this.hashRelleno)) && f?.password_hash) {
        fila = f;
        break;
      }
    }
    if (!fila || !fila.activo) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.id, rolPedido);
  }

  /** Despues de un primer factor valido: rol de la sesion y segundo factor si corresponde. */
  private async segundoPaso(usuarioId: string, rolPedido?: Rol): Promise<Tokens | DesafioSegundoFactor> {
    const roles = await this.roles(usuarioId);
    const rol = rolPedido ?? roles[0];
    if (!rol || !roles.includes(rol)) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    const factor = await this.segundoFactor(usuarioId);
    const metodo: Metodo | null = this.totpHabilitado() && factor.activo ? 'TOTP' : factor.requerido || factor.correo ? 'CORREO' : null;
    if (!metodo) {
      return this.abrirSesion(usuarioId, rol, roles);
    }
    const desafio = await this.jwt.signAsync({ sub: usuarioId, rol, metodo, tipo: 'desafio' }, { expiresIn: DESAFIO_MINUTOS * 60, algorithm: 'HS256' });
    if (metodo === 'CORREO') {
      await this.emitirCodigo(usuarioId, 0);
    }
    return {
      requiereSegundoFactor: true,
      metodo,
      enrolamiento: metodo === 'CORREO' && !factor.correo,
      destino: metodo === 'CORREO' ? enmascararCorreo(factor.email) : null,
      desafio,
    };
  }

  /** Codigo nuevo al correo de la cuenta (anula el anterior). Reenvio: 409 antes de ESPERA_REENVIO_SEGUNDOS. */
  private async emitirCodigo(usuarioId: string, esperaSegundos: number): Promise<void> {
    const codigo = nuevoCodigoCorreo();
    let email: string;
    try {
      [{ email }] = await this.bd.sinContexto('login').$queryRaw<[{ email: string }]>`
        SELECT emitir_codigo_verificacion(${usuarioId}::uuid, ${hashCodigo(this.secretoCodigos(), usuarioId, codigo)}, ${esperaSegundos}::int) AS email`;
    } catch (error) {
      if (esSqlstate(error, '55000')) {
        throw new ConflictException(`Espera ${ESPERA_REENVIO_SEGUNDOS} segundos antes de pedir otro código.`);
      }
      if (esSqlstate(error, '42501')) {
        throw new UnauthorizedException(NO_AUTORIZADO);
      }
      throw error;
    }
    await this.correos.enviarCodigo(email, codigo);
  }

  /** "Reenviar codigo" (solo metodo CORREO). */
  async reenviarCodigo(desafio: string): Promise<void> {
    const { sub, metodo } = await this.leerDesafio(desafio);
    if (metodo !== 'CORREO') {
      throw new ConflictException('Este ingreso no usa código por correo');
    }
    await this.emitirCodigo(sub, ESPERA_REENVIO_SEGUNDOS);
  }

  /**
   * Segundo paso: codigo del correo (o de la app si el metodo es TOTP) o un
   * codigo de respaldo. La primera verificacion por correo activa el segundo
   * factor y devuelve los 10 codigos de respaldo.
   */
  async verificarSegundoFactor(desafio: string, codigo: string): Promise<Tokens> {
    const { sub, rol, metodo } = await this.leerDesafio(desafio);
    if (metodo === 'TOTP' && !esCodigoRespaldo(codigo)) {
      return this.verificarTotp(desafio, codigo);
    }
    const db = this.bd.sinContexto('login');
    const hash = hashCodigo(this.secretoCodigos(), sub, codigo);
    const [{ valido }] = esCodigoRespaldo(codigo)
      ? await db.$queryRaw<[{ valido: boolean }]>`SELECT usar_codigo_respaldo(${sub}::uuid, ${hash}) AS valido`
      : await db.$queryRaw<[{ valido: boolean }]>`SELECT verificar_codigo_verificacion(${sub}::uuid, ${hash}) AS valido`;
    if (!valido) {
      throw new UnauthorizedException(CODIGO_INVALIDO);
    }
    const [{ primera }] = await db.$queryRaw<[{ primera: boolean }]>`SELECT activar_verificacion_correo(${sub}::uuid) AS primera`;
    const tokens = await this.abrirSesion(sub, rol, await this.roles(sub));
    if (!primera) {
      return tokens;
    }
    // Activacion: 10 codigos de respaldo (sin contexto; la cuenta ya probo ambos factores).
    const codigosRespaldo = nuevosCodigosRespaldo();
    const hashes = codigosRespaldo.map((c) => hashCodigo(this.secretoCodigos(), sub, c));
    await db.$executeRaw`SELECT generar_codigos_respaldo(${sub}::uuid, ${hashes}::bytea[])`;
    return { ...tokens, codigosRespaldo };
  }

  /** Enrolamiento: secreto nuevo (cifrado en la BD) y URI para la app. Solo si aun no esta activo. */
  async enrolarTotp(desafio: string): Promise<{ secreto: string; uri: string }> {
    this.exigirTotp();
    const { sub } = await this.leerDesafio(desafio);
    const secreto = nuevoSecretoTotp();
    try {
      await this.bd.sinContexto('login').$executeRaw`
        SELECT guardar_totp(${sub}::uuid, ${this.llavero.cifrarCampo(secreto, 'usuarios', 'totp_secreto', sub)})`;
    } catch (error) {
      if (esSqlstate(error, '55000')) {
        throw new ConflictException('El segundo factor ya esta activo');
      }
      throw error;
    }
    const { email } = await this.segundoFactor(sub);
    return { secreto, uri: uriTotp(secreto, email ?? sub, 'Vinculos') };
  }

  /** Segundo factor: valida el codigo (activa el TOTP si era el enrolamiento) y abre la sesion. */
  async verificarTotp(desafio: string, codigo: string): Promise<Tokens> {
    this.exigirTotp();
    const { sub, rol } = await this.leerDesafio(desafio);
    const factor = await this.segundoFactor(sub);
    const secreto = factor.secreto ? this.llavero.descifrarCampo(factor.secreto, 'usuarios', 'totp_secreto', sub) : null;
    if (!secreto || !verificarTotp(secreto, codigo)) {
      throw new UnauthorizedException('Codigo de verificacion invalido');
    }
    if (!factor.activo) {
      await this.bd.sinContexto('login').$executeRaw`SELECT activar_totp(${sub}::uuid)`;
    }
    return this.abrirSesion(sub, rol, await this.roles(sub));
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const nuevo = this.nuevoRefresh();
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string; rol: Rol }[]>`
      SELECT usuario_id::text, rol FROM rotar_sesion(${this.hash(refreshToken)}, ${this.hash(nuevo)}, ${this.vencimientoRefresh()})`;
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida, vencida o revocada');
    }
    return this.tokens(fila.usuario_id, fila.rol, nuevo, await this.roles(fila.usuario_id));
  }

  /** Cambio de rol sin cerrar sesion: revoca la familia actual y emite tokens nuevos con el rol pedido. */
  async cambiarRol(refreshToken: string, rol: Rol): Promise<Tokens> {
    const nuevo = this.nuevoRefresh();
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ id: string | null }[]>`
      SELECT cambiar_rol_sesion(${this.hash(refreshToken)}, ${this.hash(nuevo)}, ${rol}::rol, ${this.vencimientoRefresh()})::text AS id`;
    if (!fila?.id) {
      throw new UnauthorizedException('Sesion invalida o rol no disponible para la cuenta');
    }
    return this.tokens(fila.id, rol, nuevo, await this.roles(fila.id));
  }

  async logout(refreshToken: string): Promise<void> {
    await this.bd.sinContexto('login').$executeRaw`SELECT revocar_sesion(${this.hash(refreshToken)})`;
  }

  /** Recuperacion: misma respuesta exista o no la cuenta; el correo sale solo si existe. */
  async pedirRecuperacion(email: string): Promise<void> {
    const { token, hash } = nuevoTokenCorreo();
    const vence = new Date(Date.now() + HORA);
    const [{ ok }] = await this.bd.sinContexto('login').$queryRaw<[{ ok: boolean }]>`
      SELECT crear_token_recuperacion(${email}, ${hash}, ${vence}) AS ok`;
    if (ok) {
      await this.correos.enviar('RECUPERACION', email, token, vence);
    }
  }

  async confirmarRecuperacion(token: string, password: string): Promise<void> {
    await this.bd.sinContexto('login').$queryRaw`
      SELECT usar_token_recuperacion(${hashToken(token)}, ${await bcrypt.hash(password, COSTO_BCRYPT)})`;
  }

  /** Acceso sin contraseña (C-6): solo pacientes y adultos responsables; misma respuesta exista o no. */
  async pedirEnlaceAcceso(email: string): Promise<void> {
    const { token, hash } = nuevoTokenCorreo();
    const vence = new Date(Date.now() + 15 * 60_000);
    const [{ ok }] = await this.bd.sinContexto('login').$queryRaw<[{ ok: boolean }]>`
      SELECT crear_token_acceso(${email}, ${hash}, ${vence}) AS ok`;
    if (ok) {
      await this.correos.enviar('ACCESO', email, token, vence);
    }
  }

  async usarEnlaceAcceso(token: string): Promise<Tokens | DesafioSegundoFactor> {
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string }[]>`
      SELECT usuario_id::text FROM usar_token_acceso(${hashToken(token)})`;
    if (!fila) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.usuario_id);
  }

  /** Activar una invitacion: fija la contraseña (o crea la cuenta del paciente/responsable) y entra. */
  async activarInvitacion(token: string, password: string): Promise<Tokens | DesafioSegundoFactor> {
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string }[]>`
      SELECT usuario_id::text FROM activar_invitacion(${hashToken(token)}, ${await bcrypt.hash(password, COSTO_BCRYPT)}, ${randomUUID()}::uuid)`;
    if (!fila) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.usuario_id);
  }

  async confirmarCambioCorreo(token: string): Promise<void> {
    await this.bd.sinContexto('login').$executeRaw`SELECT usar_token_cambio_correo(${hashToken(token)})`;
  }

  private async abrirSesion(usuarioId: string, rol: Rol, roles: Rol[]): Promise<Tokens> {
    const refreshToken = this.nuevoRefresh();
    try {
      // La BD valida de nuevo (cuenta cerrada, rol habilitado, supervision del practicante).
      await this.bd.sinContexto('login').$executeRaw`
        SELECT crear_sesion(${usuarioId}::uuid, ${rol}::rol, ${this.hash(refreshToken)}, ${this.vencimientoRefresh()})`;
    } catch (error) {
      if (esSqlstate(error, '42501')) {
        throw new UnauthorizedException(NO_AUTORIZADO);
      }
      throw error;
    }
    return this.tokens(usuarioId, rol, refreshToken, roles);
  }

  private async roles(usuarioId: string): Promise<Rol[]> {
    const [{ roles }] = await this.bd.sinContexto('login').$queryRaw<[{ roles: Rol[] }]>`
      SELECT roles_cuenta(${usuarioId}::uuid)::text[] AS roles`;
    return roles;
  }

  private async segundoFactor(usuarioId: string) {
    const [f] = await this.bd.sinContexto('login').$queryRaw<
      { secreto: Uint8Array | null; activo: boolean; requerido: boolean; email: string | null; correo: boolean }[]
    >`SELECT secreto, activo, requerido, email, correo FROM segundo_factor(${usuarioId}::uuid)`;
    return f ?? { secreto: null, activo: false, requerido: false, email: null, correo: false };
  }

  private async leerDesafio(desafio: string): Promise<{ sub: string; rol: Rol; metodo: Metodo }> {
    try {
      const c = await this.jwt.verifyAsync<{ sub: string; rol: Rol; tipo: string; metodo?: Metodo }>(desafio, { algorithms: ['HS256'] });
      if (c.tipo !== 'desafio') {
        throw new Error('no es un desafio');
      }
      return { sub: c.sub, rol: c.rol, metodo: c.metodo ?? 'TOTP' };
    } catch {
      throw new UnauthorizedException('El ingreso venció. Vuelve a iniciar sesión.');
    }
  }

  private totpHabilitado(): boolean {
    return this.config.get<boolean>('TOTP_HABILITADO') === true;
  }

  /** TOTP apagado (03b-4.1): sus rutas no existen. */
  private exigirTotp(): void {
    if (!this.totpHabilitado()) {
      throw new NotFoundException('Ruta no encontrada');
    }
  }

  private secretoCodigos(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  private async tokens(id: string, rol: Rol, refreshToken: string, roles: Rol[]): Promise<Tokens> {
    const minutos = this.config.getOrThrow<number>('JWT_ACCESO_MINUTOS');
    const accessToken = await this.jwt.signAsync({ sub: id, rol, tipo: 'acceso' }, { expiresIn: minutos * 60, algorithm: 'HS256' });
    return { accessToken, refreshToken, expiraEn: minutos * 60, inactividadMinutos: this.inactividad(), rol, roles };
  }

  private nuevoRefresh(): string {
    return randomBytes(32).toString('base64url');
  }

  private hash(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  private inactividad(): number {
    return this.config.getOrThrow<number>('SESION_INACTIVIDAD_MINUTOS');
  }

  /** Vencimiento deslizante: la sesion muere tras SESION_INACTIVIDAD_MINUTOS sin renovar. */
  private vencimientoRefresh(): Date {
    return new Date(Date.now() + this.inactividad() * 60_000);
  }
}
