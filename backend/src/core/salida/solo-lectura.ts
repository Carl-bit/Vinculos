import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ContextoBd } from '../bd/contexto-bd.service';

export const CLAVE_EN_SALIDA = 'salida.permitida';

/**
 * R12: ruta que sigue abierta con el silo en solo lectura (salida del centro):
 * ingreso y sesion, contrasena y segundo factor propios, exportes (del centro
 * y del paciente) y derechos de los pacientes (Ley 21.719: el centro los sigue
 * respondiendo hasta la eliminacion). Va en la clase o en el metodo.
 */
export const PermitidaEnSalida = () => SetMetadata(CLAVE_EN_SALIDA, true);

const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);
const CACHE_MS = 15_000;

export interface EstadoSalida {
  soloLectura: boolean;
  desde: Date | null;
  fechaCorte: string | null;
}

/**
 * Global (despues de ModulosGuard): con el silo en solo lectura toda
 * escritura responde 423, salvo las rutas @PermitidaEnSalida y /api/internal
 * (el plano de control). Lo activa y lo quita solo el plano de control
 * (salida_interna). El estado se lee con estado_salida_silo() y se guarda
 * 15 s; quien lo cambia en esta instancia lo olvida al tiro.
 * Las tareas programadas siguen (recordatorios, exportes, purgas): no son
 * pedidos de las personas.
 */
@Injectable()
export class SoloLecturaGuard implements CanActivate {
  private cache: { valor: EstadoSalida; hasta: number } | undefined;

  constructor(
    private readonly reflector: Reflector,
    private readonly bd: ContextoBd,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<{ method: string }>();
    if (LECTURA.has(req.method.toUpperCase())) return true;
    if (this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_EN_SALIDA, [context.getHandler(), context.getClass()])) return true;
    const e = await this.estado();
    if (!e.soloLectura) return true;
    throw new HttpException(
      {
        message: `El centro esta cerrando su cuenta en Vinculos: la plataforma esta en solo lectura${e.fechaCorte ? ` hasta el ${e.fechaCorte}` : ''}. Puedes ver y exportar tus datos.`,
        restriccion: 'silo_solo_lectura',
      },
      HttpStatus.LOCKED,
    );
  }

  async estado(): Promise<EstadoSalida> {
    if (!this.cache || this.cache.hasta < Date.now()) {
      const [f] = await this.bd.sinContexto('publico').$queryRaw<[{ solo_lectura: boolean; desde: Date | null; fecha_corte: string | null }]>`
        SELECT solo_lectura, desde, fecha_corte::text AS fecha_corte FROM estado_salida_silo()`;
      this.cache = { valor: { soloLectura: f.solo_lectura, desde: f.desde, fechaCorte: f.fecha_corte }, hasta: Date.now() + CACHE_MS };
    }
    return this.cache.valor;
  }

  olvidar(): void {
    this.cache = undefined;
  }
}
