import { createHash, randomBytes } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Rol } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ContextoBd } from '../bd/contexto-bd.service';
import { esSqlstate } from '../errores/sqlstate';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos de vida del access token. */
  expiraEn: number;
  rol: Rol;
}

interface Credenciales {
  id: string;
  password_hash: string | null;
  rol: Rol;
  activo: boolean;
  fecha_expiracion_acceso: Date | null;
}

const NO_AUTORIZADO = 'Credenciales invalidas o cuenta sin acceso';

/**
 * Login y sesiones. Corre sin contexto RLS (credenciales_login y funciones de
 * sesiones, diseñadas para eso).
 *
 * Diseño del refresh token (tabla sesiones, migracion 20261012000000):
 * - Opaco (32 bytes aleatorios); la BD guarda solo su SHA-256.
 * - Rotacion: cada refresh entrega uno nuevo y marca el anterior usado.
 * - Reuso de un token usado o revocado = robo probable: se revoca la familia.
 * - Revocacion: logout (familia), y en la BD un trigger revoca todas las
 *   sesiones del usuario al cambiar rol, activo, contraseña o cierre.
 * - El access token (JWT HS256, JWT_ACCESO_MINUTOS) no se revoca, pero cada
 *   request verifica acceso_vigente() en su transaccion: un usuario
 *   desactivado o con rol cambiado queda fuera en la request siguiente.
 */
@Injectable()
export class AuthService {
  /** Hash de relleno: el tiempo de respuesta no revela si el email existe. */
  private readonly hashRelleno = bcrypt.hashSync('relleno-sin-usuario', 10);

  constructor(
    private readonly bd: ContextoBd,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<Tokens> {
    const db = this.bd.sinContexto('login');
    const [fila] = await db.$queryRaw<Credenciales[]>`
      SELECT id::text, password_hash, rol, activo, fecha_expiracion_acceso FROM credenciales_login(${email})`;
    const coincide = await bcrypt.compare(password, fila?.password_hash ?? this.hashRelleno);
    const vigente =
      !!fila &&
      fila.activo &&
      (fila.rol !== 'PRACTICANTE' || (fila.fecha_expiracion_acceso !== null && fila.fecha_expiracion_acceso > new Date()));
    if (!fila || !fila.password_hash || !coincide || !vigente) {
      throw new UnauthorizedException(NO_AUTORIZADO);
    }
    const refreshToken = this.nuevoRefresh();
    try {
      // La BD valida de nuevo (cuenta cerrada, supervision del practicante).
      await db.$executeRaw`SELECT crear_sesion(${fila.id}::uuid, ${fila.rol}::rol, ${this.hash(refreshToken)}, ${this.vencimientoRefresh()})`;
    } catch (error) {
      if (esSqlstate(error, '42501')) {
        throw new UnauthorizedException(NO_AUTORIZADO);
      }
      throw error;
    }
    return this.tokens(fila.id, fila.rol, refreshToken);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const nuevo = this.nuevoRefresh();
    const [fila] = await this.bd.sinContexto('login').$queryRaw<{ usuario_id: string; rol: Rol }[]>`
      SELECT usuario_id::text, rol FROM rotar_sesion(${this.hash(refreshToken)}, ${this.hash(nuevo)}, ${this.vencimientoRefresh()})`;
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida, vencida o revocada');
    }
    return this.tokens(fila.usuario_id, fila.rol, nuevo);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.bd.sinContexto('login').$executeRaw`SELECT revocar_sesion(${this.hash(refreshToken)})`;
  }

  private async tokens(id: string, rol: Rol, refreshToken: string): Promise<Tokens> {
    const minutos = this.config.getOrThrow<number>('JWT_ACCESO_MINUTOS');
    const accessToken = await this.jwt.signAsync({ sub: id, rol, tipo: 'acceso' }, { expiresIn: minutos * 60, algorithm: 'HS256' });
    return { accessToken, refreshToken, expiraEn: minutos * 60, rol };
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
