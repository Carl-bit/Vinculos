import { Injectable } from '@nestjs/common';
import type { AccionModulo, EstadoSolicitudModulo, ModuloCentro, Rol } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import type { ResponderSolicitudDto, SolicitarModuloDto, SolicitudModuloInterna, SolicitudModuloVista } from './dto/solicitudes-modulo.dto';

const VISTA = {
  id: true,
  modulo: true,
  accion: true,
  motivo: true,
  estado: true,
  respuesta: true,
  pedidaEn: true,
  respondidaEn: true,
} as const;

/**
 * Tarea 31 (R2 y R3 de Vinculos Control). El ADMIN pide; el operador decide y
 * aplica fuera del silo (modulos_activos no cambia aqui). Toda escritura pasa
 * por funciones SECURITY DEFINER que validan rol, estado y dependencias.
 */
@Injectable()
export class SolicitudesModuloService {
  constructor(private readonly bd: ContextoBd) {}

  /** ADMIN (RLS): las del centro, abiertas primero. */
  listar(): Promise<SolicitudModuloVista[]> {
    return this.bd.tx().solicitudModulo.findMany({ select: VISTA, orderBy: [{ pedidaEn: 'desc' }], take: 100 });
  }

  async solicitar(dto: SolicitarModuloDto): Promise<SolicitudModuloVista> {
    // 23505 del indice parcial solicitudes_modulo_una_abierta: Prisma no lo nombra en $queryRaw.
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
        SELECT solicitar_modulo(${dto.modulo}::modulo_centro, ${dto.accion}::accion_modulo, ${dto.motivo ?? null}) AS id`.catch((e: unknown) => {
      throw esSqlstate(e, '23505') ? conflicto('solicitudes_modulo_una_abierta') : e;
    });
    return this.bd.tx().solicitudModulo.findUniqueOrThrow({ where: { id }, select: VISTA });
  }

  /** R2: sin contexto de usuario; la funcion valida el token del silo. */
  async internas(token: string, desde?: Date): Promise<SolicitudModuloInterna[]> {
    const filas = await this.bd.sinContexto('interno').$queryRaw<
      {
        id: string;
        modulo: ModuloCentro;
        accion: AccionModulo;
        pedida_por_rol: Rol;
        pedida_en: Date;
        estado: EstadoSolicitudModulo;
        respondida_en: Date | null;
        actualizada_en: Date;
      }[]
    >`SELECT * FROM solicitudes_modulo_internas(${token}, ${desde ?? null}::timestamptz)`;
    return filas.map((f) => ({
      id: f.id,
      modulo: f.modulo,
      accion: f.accion,
      pedidaPorRol: f.pedida_por_rol,
      pedidaEn: f.pedida_en,
      estado: f.estado,
      respondidaEn: f.respondida_en,
      actualizadaEn: f.actualizada_en,
    }));
  }

  /** R3: idempotente (repetir el mismo estado no hace nada). */
  async responder(token: string, id: string, dto: ResponderSolicitudDto): Promise<{ estado: EstadoSolicitudModulo }> {
    const [{ estado }] = await this.bd.sinContexto('interno').$queryRaw<[{ estado: EstadoSolicitudModulo }]>`
      SELECT responder_solicitud_modulo(${token}, ${id}::uuid, ${dto.estado}::estado_solicitud_modulo, ${dto.respuesta ?? null}) AS estado`;
    return { estado };
  }
}
