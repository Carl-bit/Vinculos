import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { AccesoTemporalDto, BorradorDto, ConfirmarBorradorDto } from './dto/fichas.dto';
import { EvolucionesService } from './evoluciones.service';

const VISTA_BORRADOR = { id: true, fichaClinicaId: true, citaId: true, contenido: true, creadoEn: true, actualizadoEn: true } as const;

/**
 * Seguimiento clinico (03a): borradores de evolucion (C-8), alta del
 * paciente, acceso clinico temporal (C-4, C-5), respuestas del match del
 * paciente (D-6) y estado administrativo de las fichas de un profesional.
 */
@Injectable()
export class SeguimientoService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly evoluciones: EvolucionesService,
  ) {}

  /** Borradores propios (la RLS solo muestra los del autor). */
  async borradores(fichaId?: string) {
    const filas = await this.bd.tx().borradorEvolucion.findMany({
      where: fichaId ? { fichaClinicaId: fichaId } : {},
      select: VISTA_BORRADOR,
      orderBy: { actualizadoEn: 'desc' },
    });
    return filas.map((b) => ({ ...b, contenido: texto(b.contenido) }));
  }

  async crearBorrador(fichaId: string, dto: BorradorDto) {
    const b = await this.bd.tx().borradorEvolucion.create({
      data: { id: randomUUID(), autorId: this.bd.usuario().id, fichaClinicaId: fichaId, citaId: dto.citaId, contenido: claro(dto.contenido) },
      select: VISTA_BORRADOR,
    });
    return { ...b, contenido: texto(b.contenido) };
  }

  /** Guardado automatico. */
  async guardarBorrador(id: string, dto: BorradorDto) {
    const tx = this.bd.tx();
    encontrado(await tx.borradorEvolucion.findUnique({ where: { id }, select: { id: true } }), 'Borrador');
    const b = await tx.borradorEvolucion.update({ where: { id }, data: { contenido: claro(dto.contenido), citaId: dto.citaId }, select: VISTA_BORRADOR });
    return { ...b, contenido: texto(b.contenido) };
  }

  async descartarBorrador(id: string) {
    const tx = this.bd.tx();
    encontrado(await tx.borradorEvolucion.findUnique({ where: { id }, select: { id: true } }), 'Borrador');
    await tx.borradorEvolucion.delete({ where: { id }, select: { id: true } });
  }

  /** Confirmar: pasa a evolucion (append-only) y el borrador se elimina, en la misma transaccion. */
  async confirmarBorrador(id: string, dto: ConfirmarBorradorDto) {
    const tx = this.bd.tx();
    const b = encontrado(await tx.borradorEvolucion.findUnique({ where: { id }, select: VISTA_BORRADOR }), 'Borrador');
    const resultado = await this.evoluciones.crear(b.fichaClinicaId, { ...dto, notas: texto(b.contenido), citaId: b.citaId ?? undefined });
    await tx.borradorEvolucion.delete({ where: { id }, select: { id: true } });
    return resultado;
  }

  /** Alta (tratante): fecha y motivo cifrado; borra las respuestas del match y cierra la lista de espera. */
  async registrarAlta(pacienteId: string, fecha: Date, motivo: string) {
    const id = randomUUID();
    await this.bd.tx().$executeRaw`
      SELECT registrar_alta(${id}::uuid, ${pacienteId}::uuid, ${fecha}::date, ${this.llavero.cifrarCampo(motivo, 'altas_paciente', 'motivo', id)})`;
    return { id, pacienteId, fecha };
  }

  async altas(pacienteId: string) {
    const tx = this.bd.tx();
    const filas = await tx.altaPaciente.findMany({ where: { pacienteId }, orderBy: { fecha: 'desc' } });
    if (filas.length) {
      await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId, recurso: 'altas_paciente', accion: 'LECTURA' }]);
    }
    return filas.map((a) => ({ ...a, motivo: texto(a.motivo) }));
  }

  /** Respuestas del cuestionario con que llego el paciente (solo el tratante o acceso temporal; auditado en la BD). */
  async respuestasMatch(pacienteId: string) {
    const filas = await this.bd.tx().$queryRaw<{ solicitud_id: string; respuestas: Uint8Array; creada_en: Date }[]>`
      SELECT * FROM respuestas_match_paciente(${pacienteId}::uuid)`;
    return filas.map((f) => ({
      solicitudId: f.solicitud_id,
      creadaEn: f.creada_en,
      respuestas: JSON.parse(this.llavero.descifrarCampo(f.respuestas, 'solicitudes_hora', 'respuestas', f.solicitud_id)!) as unknown,
    }));
  }

  /** ADMIN o el tratante; avisa al paciente (aviso legal) y queda en accesos_ficha. */
  async otorgarAccesoTemporal(pacienteId: string, dto: AccesoTemporalDto) {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT otorgar_acceso_temporal(${pacienteId}::uuid, ${dto.profesionalId}::uuid, ${dto.motivo}::motivo_acceso_temporal,
                                     ${dto.alcance}::alcance_acceso_temporal, ${dto.desde ?? null}, ${dto.hasta}) AS id`;
    return this.bd.tx().accesoClinicoTemporal.findUniqueOrThrow({ where: { id } });
  }

  /** ADMIN: todos; PROFESIONAL: los que recibio y los de sus pacientes (RLS). */
  accesosTemporales(pacienteId?: string) {
    return this.bd.tx().accesoClinicoTemporal.findMany({ where: pacienteId ? { pacienteId } : {}, orderBy: { hasta: 'desc' } });
  }

  /** Ultima y proxima sesion y sesiones sin cerrar (metadata, sin contenido clinico). */
  estadoFichas(profesionalId: string) {
    return this.bd.tx().$queryRaw<
      { paciente_id: string; ultima_sesion: Date | null; proxima_sesion: Date | null; sesiones_sin_cerrar: number; alta_en: Date | null }[]
    >`SELECT * FROM estado_fichas_profesional(${profesionalId}::uuid)`;
  }
}
