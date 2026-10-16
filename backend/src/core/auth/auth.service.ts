import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Rol } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { esSqlstate } from '../errores/sqlstate';
import { CorreosCuenta } from '../notificaciones/correos-cuenta';
import { HORA, hashToken, nuevoTokenCorreo } from './tokens-correo';
import { nuevoSecretoTotp, uriTotp, verificarTotp } from './totp';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos de vida del access token. */
  expiraEn: number;
  /** Rol activo de la sesion. */
  rol: Rol;
  /** Roles con los que la cuenta puede trabajar (cambio con /auth/cambio-rol). */
  roles: Rol[];
}

/** Segundo paso del login: TOTP (o su enrolamiento si es obligatorio y no esta activo). */
export interface DesafioTotp {
  requiereTotp: true;
  enrolamiento: boolean;
  /** JWT corto (5 min) que identifica el login a medio camino. */
  desafio: string;
}

interface Credenciales {
  id: string;
  password_hash: string | null;
  rol: Rol;
  activo: boolean;
  fecha_expiracion_acceso: Date | null;
}

const NO_AUTORIZADO = 'Credenciales invalidas o cuenta sin acceso';
const COSTO_BCRYPT = 12;
const DESAFIO_MINUTOS = 5;

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
 * cerrar sesion (cambiar_rol_sesion: token nuevo). TOTP obligatorio si la
 * cuenta tiene un rol clinico (PROFESIONAL o PRACTICANTE) y opcional para el
 * resto (si lo activo, se pide). Recuperacion, acceso por enlace (pacientes)
 * e invitaciones: tokens de un solo uso por correo (tokens_correo).
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

  async login(identificador: { email?: string; rut?: string }, password: string, rolPedido?: Rol): Promise<Tokens | DesafioTotp> {
    const db = this.bd.sinContexto('login');
    const [fila] = identificador.rut
      ? await db.$queryRaw<Credenciales[]>`
          SELECT id::text, password_hash, rol, activo, fecha_expiracion_acceso
          FROM credenciales_login_rut(${Buffer.from(this.llavero.hmacRut(identificador.rut))})`
      : await db.$queryRaw<Credenciales[]>`
          SELECT id::text, password_hash, rol, activo, fecha_expiracion_acceso FROM credenciales_login(${identificador.email ?? ''})`;
    const coincide = await bcrypt.compare(password, fila?.password_hash ?? this.hashRelleno);
    if (!fila || !fila.password_hash || !coincide || !fila.activo) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.id, rolPedido);
  }

  /** Despues de un primer factor valido: rol de la sesion y TOTP si corresponde. */
  private async segundoPaso(usuarioId: string, rolPedido?: Rol): Promise<Tokens | DesafioTotp> {
    const roles = await this.roles(usuarioId);
    const rol = rolPedido ?? roles[0];
    if (!rol || !roles.includes(rol)) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    const factor = await this.segundoFactor(usuarioId);
    if (factor.requerido || factor.activo) {
      const desafio = await this.jwt.signAsync({ sub: usuarioId, rol, tipo: 'desafio' }, { expiresIn: DESAFIO_MINUTOS * 60, algorithm: 'HS256' });
      return { requiereTotp: true, enrolamiento: !factor.activo, desafio };
    }
    return this.abrirSesion(usuarioId, rol, roles);
  }

  /** Enrolamiento: secreto nuevo (cifrado en la BD) y URI para la app. Solo si aun no esta activo. */
  async enrolarTotp(desafio: string): Promise<{ secreto: string; uri: string }> {
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

  async usarEnlaceAcceso(token: string): Promise<Tokens | DesafioTotp> {
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string }[]>`
      SELECT usuario_id::text FROM usar_token_acceso(${hashToken(token)})`;
    if (!fila) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    return this.segundoPaso(fila.usuario_id);
  }

  /** Activar una invitacion: fija la contraseña (o crea la cuenta del paciente/responsable) y entra. */
  async activarInvitacion(token: string, password: string): Promise<Tokens | DesafioTotp> {
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
      { secreto: Uint8Array | null; activo: boolean; requerido: boolean; email: string | null }[]
    >`SELECT secreto, activo, requerido, email FROM segundo_factor(${usuarioId}::uuid)`;
    return f ?? { secreto: null, activo: false, requerido: false, email: null };
  }

  private async leerDesafio(desafio: string): Promise<{ sub: string; rol: Rol }> {
    try {
      const c = await this.jwt.verifyAsync<{ sub: string; rol: Rol; tipo: string }>(desafio, { algorithms: ['HS256'] });
      if (c.tipo !== 'desafio') {
        throw new Error('no es un desafio');
      }
      return { sub: c.sub, rol: c.rol };
    } catch {
      throw new UnauthorizedException('Desafio invalido o vencido: vuelva a iniciar sesion');
    }
  }

  private async tokens(id: string, rol: Rol, refreshToken: string, roles: Rol[]): Promise<Tokens> {
    const minutos = this.config.getOrThrow<number>('JWT_ACCESO_MINUTOS');
    const accessToken = await this.jwt.signAsync({ sub: id, rol, tipo: 'acceso' }, { expiresIn: minutos * 60, algorithm: 'HS256' });
    return { accessToken, refreshToken, expiraEn: minutos * 60, rol, roles };
  }

  private nuevoRefresh(): string {
    return randomBytes(32).toString('base64url');
  }

  private hash(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  private vencimientoRefresh(): Date {
    return new Date(Date.now() + this.config.getOrThrow<number>('REFRESH_DIAS') * 86_400_000);
  }
}
