import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type TipoNotificacion } from '@prisma/client';

import { texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';
import type { ArriendoDto, FiltroCobrosDto, LiquidacionDto, RegistrarPagoDto, ResolverCitaDto } from './dto/cobros.dto';

export interface EstadoPagoCita {
  cita_id: string;
  profesional_id: string;
  paciente_id: string;
  estado_cita: string;
  inicio: Date;
  fin: Date;
  monto: number | null;
  exigible: number;
  pagado: number;
  devolucion: number;
  saldo: number;
  estado_pago: 'SIN_COBRO' | 'PENDIENTE' | 'PARCIAL' | 'PAGADO';
}

/** Fecha (AAAA-MM-DD) de un Date de DTO, para columnas date. */
const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cobros (02h). Toda escritura con reglas de estado va por funciones de la BD
 * (registrar_pago, anular_pago, resolver_cita, emitir_boleta,
 * generar_liquidacion, avanzar_liquidacion). El saldo lo calcula la vista
 * estado_pago_citas bajo la RLS de quien consulta (ADMIN/GESTION todo;
 * PROFESIONAL y PACIENTE lo suyo; PRACTICANTE nada).
 *
 * El monto de la cita lo fija la BD al confirmar (tarifa mas especifica
 * vigente) y no cambia. Pasarela de pago, medios reales y SII: fuera de
 * alcance (la boleta lleva un numero simulado).
 *
 * 02i: avisa al paciente cada pago registrado y cada boleta emitida
 * (despues del COMMIT; bandeja y, segun sus preferencias, correo).
 */
@Injectable()
export class CobrosService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly eventos: EventEmitter2,
  ) {}

  estados(f: FiltroCobrosDto) {
    const condiciones = [
      f.desde ? Prisma.sql`fin > ${f.desde}` : undefined,
      f.hasta ? Prisma.sql`inicio < ${f.hasta}` : undefined,
      f.profesionalId ? Prisma.sql`profesional_id = ${f.profesionalId}::uuid` : undefined,
    ].filter((c): c is Prisma.Sql => !!c);
    const where = condiciones.length ? Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}` : Prisma.empty;
    return this.bd.tx().$queryRaw<EstadoPagoCita[]>`SELECT * FROM estado_pago_citas ${where} ORDER BY inicio LIMIT 500`;
  }

  async estado(citaId: string): Promise<EstadoPagoCita> {
    const [e] = await this.bd.tx().$queryRaw<EstadoPagoCita[]>`SELECT * FROM estado_pago_citas WHERE cita_id = ${citaId}::uuid`;
    return encontrado(e, 'Cita');
  }

  async detalle(citaId: string) {
    const tx = this.bd.tx();
    const estado = await this.estado(citaId);
    const [pagos, resolucion, boleta] = await Promise.all([
      tx.pago.findMany({ where: { citaId }, orderBy: { createdAt: 'asc' } }),
      tx.resolucionCita.findUnique({ where: { citaId } }),
      tx.boleta.findUnique({ where: { citaId } }),
    ]);
    return {
      ...estado,
      pagos,
      resolucion,
      boleta: boleta && { ...boleta, emisorNombre: texto(boleta.emisorNombre), emisorRut: texto(boleta.emisorRut) },
    };
  }

  /** Sobrepago -> 422. Si la cita queda PAGADA se emite su boleta en la misma transaccion. */
  async registrarPago(citaId: string, dto: RegistrarPagoDto) {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT registrar_pago(${citaId}::uuid, ${dto.monto}::int, ${dto.medioPago}::medio_pago) AS id`;
    this.avisar('PAGO_REGISTRADO', (await this.estado(citaId)).paciente_id, id);
    await this.emitirBoleta(citaId);
    return this.detalle(citaId);
  }

  /** Con motivo; nunca borra. Con boleta emitida o ya liquidado -> 409. */
  async anularPago(pagoId: string, motivo: string) {
    await this.bd.tx().$executeRaw`SELECT anular_pago(${pagoId}::uuid, ${motivo})`;
    return encontrado(await this.bd.tx().pago.findUnique({ where: { id: pagoId } }), 'Pago');
  }

  /** Politica de cancelacion e inasistencia (porcentajes de configuracion_centro). */
  async resolver(citaId: string, dto: ResolverCitaDto) {
    const nueva = dto.decision === 'TRASLADO' ? dto.citaNuevaId! : null;
    await this.bd.tx().$queryRaw`
      SELECT resolver_cita(${citaId}::uuid, ${dto.decision}::decision_cita, ${nueva}::uuid, ${dto.motivo ?? null})`;
    if (nueva) {
      await this.emitirBoleta(nueva);
    }
    return this.detalle(citaId);
  }

  /**
   * Boleta unica al quedar PAGADA, con copia del emisor (cifrada con el id
   * que genera la API): el profesional si cobro directo, si no el centro.
   * Sin RUT registrado se guarda un valor explicito ("sin RUT").
   */
  private async emitirBoleta(citaId: string) {
    const tx = this.bd.tx();
    const estado = await this.estado(citaId);
    if (estado.estado_pago !== 'PAGADO' || (await tx.boleta.count({ where: { citaId } })) > 0) {
      return;
    }
    const directo = (await tx.pago.count({ where: { citaId, estado: 'REGISTRADO', cobradoPor: 'PROFESIONAL' } })) > 0;
    let nombre: string;
    let rut: string | null;
    if (directo) {
      const [p] = await tx.$queryRaw<{ nombre: string | null }[]>`SELECT nombre FROM directorio_interno() WHERE id = ${estado.profesional_id}::uuid`;
      const privados = await tx.profesionalDatosPrivados.findUnique({ where: { usuarioId: estado.profesional_id }, select: { usuarioId: true, rut: true } });
      nombre = p?.nombre ?? 'Profesional';
      rut = texto(privados?.rut);
    } else {
      const c = await tx.configuracionCentro.findUniqueOrThrow({ where: { id: true } });
      nombre = c.nombreCentro;
      rut = c.rutCentro;
    }
    const id = randomUUID();
    const [{ numero }] = await tx.$queryRaw<[{ numero: string | null }]>`
      SELECT emitir_boleta(${id}::uuid, ${citaId}::uuid,
                           ${this.llavero.cifrarCampo(nombre, 'boletas', 'emisor_nombre', id)},
                           ${this.llavero.cifrarCampo(rut ?? 'sin RUT', 'boletas', 'emisor_rut', id)}) AS numero`;
    if (numero) {
      this.avisar('BOLETA_EMITIDA', estado.paciente_id, id);
    }
  }

  private avisar(tipo: TipoNotificacion, pacienteId: string, referenciaId: string) {
    const evento: NotificacionSolicitada = { actor: this.bd.usuario(), tipo, destino: { pacienteId }, referenciaId };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
  }

  arriendos(profesionalId?: string) {
    return this.bd.tx().arriendo.findMany({ where: { profesionalId }, orderBy: { periodoDesde: 'desc' } });
  }

  crearArriendo(dto: ArriendoDto) {
    return this.bd.tx().arriendo.create({
      data: { profesionalId: dto.profesionalId, espacioId: dto.espacioId, periodoDesde: dto.desde, periodoHasta: dto.hasta, monto: dto.monto },
    });
  }

  liquidaciones(profesionalId?: string) {
    return this.bd.tx().liquidacion.findMany({ where: { profesionalId }, orderBy: { periodoDesde: 'desc' } });
  }

  /** BORRADOR (recalcula si ya existe uno del mismo periodo). Periodo solapado -> 409. */
  async generarLiquidacion(dto: LiquidacionDto) {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT generar_liquidacion(${dto.profesionalId}::uuid, ${dia(dto.desde)}::date, ${dia(dto.hasta)}::date) AS id`;
    return encontrado(await this.bd.tx().liquidacion.findUnique({ where: { id } }), 'Liquidacion');
  }

  async avanzarLiquidacion(id: string, estado: 'EMITIDA' | 'PAGADA') {
    await this.bd.tx().$executeRaw`SELECT avanzar_liquidacion(${id}::uuid, ${estado}::estado_liquidacion)`;
    return encontrado(await this.bd.tx().liquidacion.findUnique({ where: { id } }), 'Liquidacion');
  }
}
