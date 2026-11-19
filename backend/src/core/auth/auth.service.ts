import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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
import { LimitePorCorreo } from './limite-correo';
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

/**
 * Aviso cuando piden recuperar o entrar con un correo sin cuenta en el centro.
 * Solo lo recibe quien controla esa casilla: le dice la verdad sin revelarla a
 * quien escribio el correo en el formulario. Sin enlace ni datos de nadie.
 */
const AVISO_SIN_CUENTA = {
  recuperacion: {
    asunto: 'Solicitud de recuperación de contraseña',
    texto:
      'Alguien pidió recuperar la contraseña de una cuenta con este correo, pero no hay ninguna cuenta del centro asociada a esta dirección.\n\nSi fuiste tú, puede que te hayas registrado con otro correo: pruébalo o consulta con el centro. Si no fuiste tú, ignora este mensaje; nadie puede entrar con esta dirección.',
  },
  acceso: {
    asunto: 'Solicitud de enlace de acceso',
    texto:
      'Alguien pidió un enlace de acceso con este correo, pero no hay una cuenta de paciente del centro asociada a esta dirección.\n\nSi eres del equipo del centro, entra con tu correo y contraseña. Si eres paciente, puede que te hayas registrado con otro correo: pruébalo o consulta con el centro. Si no fuiste tú, ignora este mensaje.',
  },
} as const;
/** Cubre los 10 minutos del codigo por correo y un reenvio. */
const DESAFIO_MINUTOS = 15;
const CODIGO_INVALIDO = 'El código no es válido o venció. Puedes pedir uno nuevo.';
const SESION_REEMPLAZADA = 'Tu sesión se cerró porque se inició sesión con tu cuenta en otro navegador o dispositivo.';
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
 * codigos de respaldo. R10 (2026-11-19): un silo de demostracion (ES_DEMO=true
 * y silo_es_demo() en la BD) no lo pide: cuentas ficticias de un demo de 24 h. El TOTP de 03a queda tras TOTP_HABILITADO (apagado):
 * sus rutas responden 404 y el login nunca lo pide.
 *
 * 2026-11-07 (docs/api/sesion_unica_conexiones.md): una sola sesion por
 * usuario. crear_sesion cierra la anterior (NUEVA_SESION); el access token
 * lleva la familia (`sid`) y cada request exige sesion_vigente(sid), asi que
 * la sesion cerrada deja de servir de inmediato. Cada sesion guarda un
 * resumen del navegador (`dispositivo`) para el registro de conexiones.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  /** Hash de relleno: el tiempo de respuesta no revela si el email existe. */
  private readonly hashRelleno = bcrypt.hashSync('relleno-sin-usuario', 10);

  /** Correos de recuperacion y de enlace de acceso por direccion, existan o no: 3 por hora. */
  private readonly correosPorDireccion = new LimitePorCorreo(3, HORA);

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
  async login(
    identificador: { email?: string; rut?: string },
    password: string,
    rolPedido: Rol | undefined,
    dispositivo: string | null,
  ): Promise<Tokens | DesafioSegundoFactor> {
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
      // AUD-01 (E2.4): solo el HMAC del identificador, para detectar intentos repetidos (nunca el valor).
      const clave = identificador.rut
        ? `rut:${Buffer.from(this.llavero.hmacRut(identificador.rut)).toString('hex')}`
        : `correo:${(identificador.email ?? '').trim().toLowerCase()}`;
      await db.$executeRaw`SELECT registrar_login_fallido(${this.llavero.hmacIdentificador(clave)})`.catch(() => undefined);
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.id, rolPedido, dispositivo);
  }

  /** Despues de un primer factor valido: rol de la sesion y segundo factor si corresponde. */
  private async segundoPaso(usuarioId: string, rolPedido: Rol | undefined, dispositivo: string | null): Promise<Tokens | DesafioSegundoFactor> {
    const roles = await this.roles(usuarioId);
    const rol = rolPedido ?? roles[0];
    if (!rol || !roles.includes(rol)) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    if (await this.esDemo()) {
      return this.abrirSesion(usuarioId, rol, roles, dispositivo);
    }
    const factor = await this.segundoFactor(usuarioId);
    const metodo: Metodo | null = this.totpHabilitado() && factor.activo ? 'TOTP' : factor.requerido || factor.correo ? 'CORREO' : null;
    if (!metodo) {
      return this.abrirSesion(usuarioId, rol, roles, dispositivo);
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
    try {
      await this.correos.enviarCodigo(email, codigo);
    } catch {
      // AUD-02 (EXT-03): proveedor caido o lento (corta por TIEMPOS_SMTP). Sin datos del correo en el log.
      this.logger.warn('No se pudo enviar el codigo de verificacion');
      throw new ServiceUnavailableException('No pudimos enviar el código a tu correo. Intenta de nuevo en unos minutos.');
    }
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
  async verificarSegundoFactor(desafio: string, codigo: string, dispositivo: string | null): Promise<Tokens> {
    const { sub, rol, metodo } = await this.leerDesafio(desafio);
    if (metodo === 'TOTP' && !esCodigoRespaldo(codigo)) {
      return this.verificarTotp(desafio, codigo, dispositivo);
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
    const tokens = await this.abrirSesion(sub, rol, await this.roles(sub), dispositivo);
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
  async verificarTotp(desafio: string, codigo: string, dispositivo: string | null): Promise<Tokens> {
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
    return this.abrirSesion(sub, rol, await this.roles(sub), dispositivo);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const nuevo = this.nuevoRefresh();
    const db = this.bd.sinContexto('login');
    const [fila] = await db.$queryRaw<{ usuario_id: string; rol: Rol; familia_id: string }[]>`
      SELECT usuario_id::text, rol, familia_id::text
      FROM rotar_sesion(${this.hash(refreshToken)}, ${this.hash(nuevo)}, ${this.vencimientoRefresh()})`;
    if (!fila) {
      // Por que se cerro (solo lo sabe quien tiene el token): el front avisa si fue otro ingreso.
      const [{ motivo }] = await db.$queryRaw<[{ motivo: string | null }]>`SELECT motivo_fin_sesion(${this.hash(refreshToken)}) AS motivo`;
      if (motivo === 'NUEVA_SESION') {
        throw new UnauthorizedException({ message: SESION_REEMPLAZADA, motivo });
      }
      throw new UnauthorizedException('Sesion invalida, vencida o revocada');
    }
    return this.tokens(fila.usuario_id, fila.rol, nuevo, await this.roles(fila.usuario_id), fila.familia_id);
  }

  /** Cambio de rol sin cerrar sesion: revoca la familia actual y emite tokens nuevos con el rol pedido. */
  async cambiarRol(refreshToken: string, rol: Rol): Promise<Tokens> {
    const nuevo = this.nuevoRefresh();
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string; familia_id: string }[]>`
      SELECT usuario_id::text, familia_id::text
      FROM cambiar_rol_sesion(${this.hash(refreshToken)}, ${this.hash(nuevo)}, ${rol}::rol, ${this.vencimientoRefresh()})`;
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida o rol no disponible para la cuenta');
    }
    return this.tokens(fila.usuario_id, rol, nuevo, await this.roles(fila.usuario_id), fila.familia_id);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.bd.sinContexto('login').$executeRaw`SELECT revocar_sesion(${this.hash(refreshToken)})`;
  }

  /**
   * Recuperacion: misma respuesta y mismo tiempo exista o no la cuenta. Siempre
   * sale un correo: con la cuenta, el enlace; sin ella, el aviso de que no hay
   * cuenta con esa direccion (solo lo lee quien controla la casilla, asi que
   * no revela nada a quien escribio el correo). Tope de 3 por hora por direccion.
   */
  async pedirRecuperacion(email: string): Promise<void> {
    await this.responderParejo('recuperacion', async () => {
      if (!this.correosPorDireccion.permitir(email)) return;
      const { token, hash } = nuevoTokenCorreo();
      const vence = new Date(Date.now() + HORA);
      const [{ ok }] = await this.bd.sinContexto('login').$queryRaw<[{ ok: boolean }]>`
        SELECT crear_token_recuperacion(${email}, ${hash}, ${vence}) AS ok`;
      if (ok) await this.correos.enviar('RECUPERACION', email, token, vence);
      else await this.correos.enviarAviso(email, AVISO_SIN_CUENTA.recuperacion.asunto, AVISO_SIN_CUENTA.recuperacion.texto);
    });
  }

  /**
   * La respuesta tarda siempre CUENTA_RESPUESTA_MS: el trabajo (consulta y
   * correo) corre en segundo plano y no cambia el tiempo ni la respuesta. Sus
   * errores se registran sin el correo.
   */
  private async responderParejo(que: string, trabajo: () => Promise<void>): Promise<void> {
    const espera = new Promise((r) => setTimeout(r, this.config.get<number>('CUENTA_RESPUESTA_MS') ?? 1200));
    void trabajo().catch(() => this.logger.warn(`No se pudo procesar la solicitud de ${que}`));
    await espera;
  }

  async confirmarRecuperacion(token: string, password: string): Promise<void> {
    await this.bd.sinContexto('login').$queryRaw`
      SELECT usar_token_recuperacion(${hashToken(token)}, ${await bcrypt.hash(password, COSTO_BCRYPT)})`;
  }

  /**
   * Acceso sin contraseña (C-6): solo pacientes y adultos responsables. Igual
   * que la recuperacion: mismo tiempo y siempre un correo (enlace, o aviso de
   * que no hay una cuenta de paciente con esa direccion).
   */
  async pedirEnlaceAcceso(email: string): Promise<void> {
    await this.responderParejo('enlace de acceso', async () => {
      if (!this.correosPorDireccion.permitir(email)) return;
      const { token, hash } = nuevoTokenCorreo();
      const vence = new Date(Date.now() + 15 * 60_000);
      const [{ ok }] = await this.bd.sinContexto('login').$queryRaw<[{ ok: boolean }]>`
        SELECT crear_token_acceso(${email}, ${hash}, ${vence}) AS ok`;
      if (ok) await this.correos.enviar('ACCESO', email, token, vence);
      else await this.correos.enviarAviso(email, AVISO_SIN_CUENTA.acceso.asunto, AVISO_SIN_CUENTA.acceso.texto);
    });
  }

  async usarEnlaceAcceso(token: string, dispositivo: string | null): Promise<Tokens | DesafioSegundoFactor> {
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string }[]>`
      SELECT usuario_id::text FROM usar_token_acceso(${hashToken(token)})`;
    if (!fila) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.usuario_id, undefined, dispositivo);
  }

  /** Activar una invitacion: fija la contraseña (o crea la cuenta del paciente/responsable) y entra. */
  async activarInvitacion(token: string, password: string, dispositivo: string | null): Promise<Tokens | DesafioSegundoFactor> {
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string }[]>`
      SELECT usuario_id::text FROM activar_invitacion(${hashToken(token)}, ${await bcrypt.hash(password, COSTO_BCRYPT)}, ${randomUUID()}::uuid)`;
    if (!fila) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.usuario_id, undefined, dispositivo);
  }

  async confirmarCambioCorreo(token: string): Promise<void> {
    await this.bd.sinContexto('login').$executeRaw`SELECT usar_token_cambio_correo(${hashToken(token)})`;
  }

  private async abrirSesion(usuarioId: string, rol: Rol, roles: Rol[], dispositivo: string | null): Promise<Tokens> {
    const refreshToken = this.nuevoRefresh();
    let familia: string;
    try {
      // La BD valida de nuevo (cuenta cerrada, rol habilitado, supervision del practicante) y cierra la sesion anterior.
      [{ familia }] = await this.bd.sinContexto('login').$queryRaw<[{ familia: string }]>`
        SELECT crear_sesion(${usuarioId}::uuid, ${rol}::rol, ${this.hash(refreshToken)}, ${this.vencimientoRefresh()}, ${dispositivo})::text AS familia`;
    } catch (error) {
      if (esSqlstate(error, '42501')) {
        throw new UnauthorizedException(NO_AUTORIZADO);
      }
      throw error;
    }
    return this.tokens(usuarioId, rol, refreshToken, roles, familia);
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

  /**
   * R10: demo sin segundo factor. Exige las dos marcas: ES_DEMO=true en el
   * entorno (lo escribe el plano de control solo para sus demos) y
   * identidad_silo.es_demo en la BD (solo el dueno, al crear el silo). Un silo
   * real nunca tiene la segunda: ahi siempre se pide el codigo.
   */
  private async esDemo(): Promise<boolean> {
    if (this.config.get<boolean>('ES_DEMO') !== true) {
      return false;
    }
    const [f] = await this.bd.sinContexto('login').$queryRaw<{ demo: boolean }[]>`SELECT silo_es_demo() AS demo`;
    return f?.demo === true;
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

  /** `sid` = familia de la sesion: cada request la valida con sesion_vigente(). */
  private async tokens(id: string, rol: Rol, refreshToken: string, roles: Rol[], familia: string): Promise<Tokens> {
    const minutos = this.config.getOrThrow<number>('JWT_ACCESO_MINUTOS');
    const accessToken = await this.jwt.signAsync({ sub: id, rol, sid: familia, tipo: 'acceso' }, { expiresIn: minutos * 60, algorithm: 'HS256' });
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
