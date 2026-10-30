import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type MedioPago, type TipoNotificacion } from '@prisma/client';

import { registrarExportacion } from '../../core/bd/auditoria';
import { texto } from '../../core/bd/claro';
import { generarPdfTabla } from '../../core/documentos/pdf';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';
import type { ArriendoDto, FiltroCobrosDto, LiquidacionDto, RegistrarDocumentoTributarioDto, RegistrarPagoDto, ResolverCitaDto } from './dto/cobros.dto';

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

export interface DeudaPaciente {
  paciente_id: string;
  sesiones: number;
  saldo: number;
  desde: Date;
  citas: string[];
}

export interface ReporteCobros {
  desde: string;
  hasta: string;
  profesionales: { profesional_id: string; nombre: string | null; sesiones: number; cobrado: number; pendiente: number; comision_estimada: number }[];
  medios: { medio: MedioPago; pagos: number; monto: number }[];
}

/**
 * Cobros (02h). Toda escritura con reglas de estado va por funciones de la BD
 * (registrar_pago, anular_pago, resolver_cita, emitir_comprobante_pago,
 * registrar_documento_tributario, anular_documento_tributario,
 * generar_liquidacion, avanzar_liquidacion). El saldo lo calcula la vista
 * estado_pago_citas bajo la RLS de quien consulta (ADMIN/GESTION todo;
 * PROFESIONAL y PACIENTE lo suyo; PRACTICANTE nada).
 *
 * El monto de la cita lo fija la BD al confirmar (tarifa mas especifica
 * vigente) y no cambia. AUD-01: el sistema emite un comprobante de pago
 * (no tributario); la boleta del SII la emite fuera quien cobro y aqui solo
 * se registra (folio, tipo, fecha y monto).
 *
 * 02i: avisa al paciente cada pago registrado y cada comprobante emitido
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
    // 03b-4.2: inasistencia = resolucion INASISTENCIA (simbolo "no asistio" en la agenda).
    return this.bd.tx().$queryRaw<(EstadoPagoCita & { inasistencia: boolean })[]>`
      SELECT e.*, EXISTS (SELECT 1 FROM resoluciones_cita r WHERE r.cita_id = e.cita_id AND r.decision = 'INASISTENCIA') AS inasistencia
      FROM estado_pago_citas e ${where} ORDER BY e.inicio LIMIT 500`;
  }

  async estado(citaId: string): Promise<EstadoPagoCita> {
    const [e] = await this.bd.tx().$queryRaw<EstadoPagoCita[]>`SELECT * FROM estado_pago_citas WHERE cita_id = ${citaId}::uuid`;
    return encontrado(e, 'Cita');
  }

  async detalle(citaId: string) {
    const tx = this.bd.tx();
    const estado = await this.estado(citaId);
    const [pagos, resolucion, comprobante, tributarios] = await Promise.all([
      tx.pago.findMany({ where: { citaId }, orderBy: { createdAt: 'asc' } }),
      tx.resolucionCita.findUnique({ where: { citaId } }),
      tx.comprobantePago.findUnique({ where: { citaId } }),
      tx.documentoTributario.findMany({ where: { citaId }, orderBy: { registradoEn: 'asc' } }),
    ]);
    return {
      ...estado,
      pagos,
      resolucion,
      comprobante: comprobante && { ...comprobante, emisorNombre: texto(comprobante.emisorNombre), emisorRut: texto(comprobante.emisorRut) },
      documentosTributarios: tributarios.map((d) => ({
        id: d.id,
        citaId: d.citaId,
        tipo: d.tipo,
        folio: d.folio,
        emisor: d.emisor,
        fechaEmision: d.fechaEmision.toISOString().slice(0, 10),
        monto: d.monto,
        estado: d.estado,
        registradoEn: d.registradoEn,
        anuladoEn: d.anuladoEn,
        motivoAnulacion: d.motivoAnulacion,
      })),
    };
  }

  /** 03b-3.3: deudas por paciente (ADMIN/GESTION todas; PROFESIONAL las de sus citas). */
  deudas(): Promise<DeudaPaciente[]> {
    return this.bd.tx().$queryRaw<DeudaPaciente[]>`SELECT * FROM deudas_pacientes()`;
  }

  /** Sobrepago -> 422. Si la cita queda PAGADA se emite su comprobante en la misma transaccion. */
  async registrarPago(citaId: string, dto: RegistrarPagoDto) {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT registrar_pago(${citaId}::uuid, ${dto.monto}::int, ${dto.medioPago}::medio_pago) AS id`;
    this.avisar('PAGO_REGISTRADO', (await this.estado(citaId)).paciente_id, id);
    await this.emitirComprobante(citaId);
    return this.detalle(citaId);
  }

  /** Con motivo; nunca borra. Con comprobante emitido o ya liquidado -> 409. */
  async anularPago(pagoId: string, motivo: string) {
    await this.bd.tx().$executeRaw`SELECT anular_pago(${pagoId}::uuid, ${motivo})`;
    return encontrado(await this.bd.tx().pago.findUnique({ where: { id: pagoId } }), 'Pago');
  }

  /**
   * Politica de cancelacion e inasistencia (porcentajes de configuracion_centro).
   * 03b-3.3: TRASLADO o DEVOLUCION de una cita confirmada ya terminada =
   * inasistencia justificada (exige motivo; la devolucion lleva la penalizacion
   * de la cancelacion tardia).
   */
  async resolver(citaId: string, dto: ResolverCitaDto) {
    const nueva = dto.decision === 'TRASLADO' ? dto.citaNuevaId! : null;
    await this.bd.tx().$queryRaw`
      SELECT resolver_cita(${citaId}::uuid, ${dto.decision}::decision_cita, ${nueva}::uuid, ${dto.motivo ?? null})`;
    if (nueva) {
      await this.emitirComprobante(nueva);
    }
    return this.detalle(citaId);
  }

  /**
   * AUD-01 (E1.4): boleta o factura del SII emitida fuera por quien cobro.
   * La BD decide el emisor y quien puede (registrar_documento_tributario).
   */
  async registrarTributario(citaId: string, dto: RegistrarDocumentoTributarioDto) {
    await this.bd.tx().$queryRaw`
      SELECT registrar_documento_tributario(${citaId}::uuid, ${dto.tipo}::tipo_documento_tributario, ${dto.folio},
                                            ${dto.fechaEmision}::date, ${dto.monto}::int)`;
    return this.detalle(citaId);
  }

  /** Anula con motivo (quien lo emitio); el documento queda registrado. */
  async anularTributario(id: string, motivo: string) {
    await this.bd.tx().$executeRaw`SELECT anular_documento_tributario(${id}::uuid, ${motivo})`;
    const d = encontrado(await this.bd.tx().documentoTributario.findUnique({ where: { id }, select: { citaId: true } }), 'Documento');
    return this.detalle(d.citaId);
  }

  /**
   * Comprobante de pago (no tributario) unico al quedar PAGADA, con copia del
   * emisor (cifrada con el id que genera la API): el profesional si cobro
   * directo, si no el centro. Sin RUT registrado se guarda "sin RUT".
   */
  private async emitirComprobante(citaId: string) {
    const tx = this.bd.tx();
    const estado = await this.estado(citaId);
    if (estado.estado_pago !== 'PAGADO' || (await tx.comprobantePago.count({ where: { citaId } })) > 0) {
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
      SELECT emitir_comprobante_pago(${id}::uuid, ${citaId}::uuid,
                           ${this.llavero.cifrarCampo(nombre, 'comprobantes_pago', 'emisor_nombre', id)},
                           ${this.llavero.cifrarCampo(rut ?? 'sin RUT', 'comprobantes_pago', 'emisor_rut', id)}) AS numero`;
    if (numero) {
      this.avisar('COMPROBANTE_EMITIDO', estado.paciente_id, id);
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

  /** Cobros por profesional del periodo (sesiones realizadas, cobrado, pendiente, comision) y medios de pago. */
  async reporte(desde: Date, hasta: Date) {
    const [{ r }] = await this.bd.tx().$queryRaw<[{ r: ReporteCobros }]>`SELECT reporte_cobros(${dia(desde)}::date, ${dia(hasta)}::date) AS r`;
    return r;
  }

  /** AUD-01: la descarga queda en registro_exportaciones (sin datos de pacientes: agregados por profesional). */
  async reportePdf(desde: Date, hasta: Date): Promise<Buffer> {
    const r = await this.reporte(desde, hasta);
    await registrarExportacion(this.bd.tx(), this.bd.usuario(), { recurso: 'reporte_cobros', detalle: `periodo ${r.desde} a ${r.hasta}` });
    const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
    const t = r.profesionales.reduce((a, p) => ({ s: a.s + p.sesiones, c: a.c + p.cobrado, p: a.p + p.pendiente, m: a.m + p.comision_estimada }), {
      s: 0,
      c: 0,
      p: 0,
      m: 0,
    });
    return generarPdfTabla({
      centro: await this.nombreCentro(),
      titulo: 'Reporte de cobros',
      subtitulo: `Periodo ${r.desde} a ${r.hasta} (citas por fecha de inicio)`,
      columnas: ['Profesional', 'Sesiones', 'Cobrado', 'Pendiente', 'Comision'],
      filas: [
        ...r.profesionales.map((p) => [p.nombre ?? 'Profesional', p.sesiones, pesos(p.cobrado), pesos(p.pendiente), pesos(p.comision_estimada)]),
        ['Total', t.s, pesos(t.c), pesos(t.p), pesos(t.m)],
      ],
      pie: [`Medios de pago: ${r.medios.map((m) => `${m.medio} ${m.pagos} (${pesos(m.monto)})`).join(', ') || 'sin pagos'}`],
    });
  }

  /** PDF de una liquidacion (ADMIN/GESTION; el profesional las suyas emitidas, RLS). */
  async liquidacionPdf(id: string): Promise<Buffer> {
    const l = encontrado(await this.bd.tx().liquidacion.findUnique({ where: { id } }), 'Liquidacion');
    await registrarExportacion(this.bd.tx(), this.bd.usuario(), { recurso: 'liquidaciones', referenciaId: l.id });
    const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
    return generarPdfTabla({
      centro: await this.nombreCentro(),
      titulo: `Liquidacion ${l.estado.toLowerCase()}`,
      subtitulo: `Periodo ${dia(l.periodoDesde)} a ${dia(l.periodoHasta)}`,
      columnas: ['Concepto', 'Monto'],
      filas: [
        ['Cobrado por el centro (citas realizadas)', pesos(l.totalCobrado)],
        ...(l.comisionDerivacion > 0 || l.sesionesDerivadas > 0
          ? [
              [`Comision del centro (${l.comisionPorcentaje.toString()}%)`, `-${pesos(l.comision - l.comisionDerivacion)}`],
              [`Comision por derivacion (${l.sesionesDerivadas} sesiones de pacientes del centro)`, `-${pesos(l.comisionDerivacion)}`],
            ]
          : [[`Comision del centro (${l.comisionPorcentaje.toString()}%)`, `-${pesos(l.comision)}`]]),
        ['Arriendos del periodo', `-${pesos(l.arriendos)}`],
        ['Total a pagar', pesos(l.total)],
      ],
      pie: [`Profesional: ${l.profesionalId}`],
    });
  }

  private async nombreCentro(): Promise<string> {
    const c = await this.bd.tx().configuracionCentro.findUnique({ where: { id: true }, select: { nombreCentro: true } });
    return c?.nombreCentro ?? 'Centro';
  }

  async avanzarLiquidacion(id: string, estado: 'EMITIDA' | 'PAGADA') {
    await this.bd.tx().$executeRaw`SELECT avanzar_liquidacion(${id}::uuid, ${estado}::estado_liquidacion)`;
    return encontrado(await this.bd.tx().liquidacion.findUnique({ where: { id } }), 'Liquidacion');
  }
}
