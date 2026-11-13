import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { MotivoRevocacionAcceso } from '@prisma/client';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { AccesoTemporalDto, BorradorDto, ConfirmarBorradorDto, PendienteFicha } from './dto/fichas.dto';
import { EvolucionesService } from './evoluciones.service';
import { PlantillasService } from './plantillas.service';

const VISTA_BORRADOR = {
  id: true,
  fichaClinicaId: true,
  citaId: true,
  contenido: true,
  plantillaId: true,
  valores: true,
  nivelRiesgo: true,
  creadoEn: true,
  actualizadoEn: true,
} as const;

const vistaBorrador = <B extends { contenido: Uint8Array; valores: Uint8Array | null }>(b: B) => ({
  ...b,
  contenido: texto(b.contenido),
  valores: b.valores ? (JSON.parse(texto(b.valores)) as Record<string, unknown>) : null,
});

const vistaAcceso = <A extends { revocacion: { motivo: MotivoRevocacionAcceso; revocadoEn: Date } | null }>({ revocacion, ...a }: A) => ({
  ...a,
  revocadoEn: revocacion?.revocadoEn ?? null,
  motivoRevocacion: revocacion?.motivo ?? null,
});

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
    private readonly plantillas: PlantillasService,
  ) {}

  /** Borradores propios (la RLS solo muestra los del autor). */
  async borradores(fichaId?: string) {
    const tx = this.bd.tx();
    const filas = await tx.borradorEvolucion.findMany({
      where: fichaId ? { fichaClinicaId: fichaId } : {},
      select: VISTA_BORRADOR,
      orderBy: { actualizadoEn: 'desc' },
    });
    // Paciente de cada borrador (para la lista de pendientes). Sin include: si
    // el autor perdio el acceso a la ficha (derivacion), la RLS la oculta y el
    // borrador queda con pacienteId null en vez de romper la consulta.
    const fichas = await tx.fichaClinica.findMany({
      where: { id: { in: [...new Set(filas.map((b) => b.fichaClinicaId))] } },
      select: { id: true, pacienteId: true },
    });
    const paciente = new Map(fichas.map((f) => [f.id, f.pacienteId]));
    return filas.map((b) => ({ ...vistaBorrador(b), pacienteId: paciente.get(b.fichaClinicaId) ?? null }));
  }

  /** Valores de plantilla de un borrador: tipos y opciones validos; los obligatorios se exigen al confirmar. */
  private async valoresBorrador(dto: BorradorDto) {
    return dto.plantillaId ? claro(await this.plantillas.valoresValidos(dto.plantillaId, dto.valores!, false)) : null;
  }

  async crearBorrador(fichaId: string, dto: BorradorDto) {
    const b = await this.bd.tx().borradorEvolucion.create({
      data: {
        id: randomUUID(),
        autorId: this.bd.usuario().id,
        fichaClinicaId: fichaId,
        citaId: dto.citaId,
        contenido: claro(dto.contenido),
        plantillaId: dto.plantillaId ?? null,
        valores: await this.valoresBorrador(dto),
        nivelRiesgo: dto.nivelRiesgo ?? null,
      },
      select: VISTA_BORRADOR,
    });
    return vistaBorrador(b);
  }

  /** Guardado automatico. */
  async guardarBorrador(id: string, dto: BorradorDto) {
    const tx = this.bd.tx();
    encontrado(await tx.borradorEvolucion.findUnique({ where: { id }, select: { id: true } }), 'Borrador');
    const b = await tx.borradorEvolucion.update({
      where: { id },
      data: {
        contenido: claro(dto.contenido),
        citaId: dto.citaId,
        plantillaId: dto.plantillaId ?? null,
        valores: await this.valoresBorrador(dto),
        nivelRiesgo: dto.nivelRiesgo ?? null,
      },
      select: VISTA_BORRADOR,
    });
    return vistaBorrador(b);
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
    const resultado = await this.evoluciones.crear(b.fichaClinicaId, {
      ...dto,
      notas: texto(b.contenido),
      citaId: b.citaId ?? undefined,
      plantillaId: b.plantillaId ?? undefined,
      valores: b.valores ? (JSON.parse(texto(b.valores)) as Record<string, unknown>) : undefined,
    });
    await tx.borradorEvolucion.delete({ where: { id }, select: { id: true } });
    return resultado;
  }

  /** 03b-4.2: sesiones del rango con evolucion (solo ids). */
  async citasConEvolucion(desde: Date, hasta: Date): Promise<string[]> {
    const filas = await this.bd.tx().$queryRaw<{ cita_id: string }[]>`
      SELECT DISTINCT e.cita_id FROM evoluciones e JOIN citas c ON c.id = e.cita_id
      WHERE c.inicio >= ${desde} AND c.inicio < ${hasta}`;
    return filas.map((f) => f.cita_id);
  }

  /** Alta (tratante): fecha y motivo cifrado; borra las respuestas del match. */
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
    return this.accesoTemporal(id);
  }

  /** ADMIN: todos; PROFESIONAL: los que recibio y los de sus pacientes (RLS). */
  async accesosTemporales(pacienteId?: string) {
    const filas = await this.bd
      .tx()
      .accesoClinicoTemporal.findMany({ where: pacienteId ? { pacienteId } : {}, include: { revocacion: true }, orderBy: { hasta: 'desc' } });
    return filas.map(vistaAcceso);
  }

  /** ADMIN o el tratante; solo un acceso vigente y sin sesiones por cubrir (422). Avisa al paciente y al profesional. */
  async revocarAccesoTemporal(id: string, motivo: MotivoRevocacionAcceso) {
    await this.bd.tx().$executeRaw`SELECT revocar_acceso_temporal(${id}::uuid, ${motivo}::motivo_revocacion_acceso)`;
    return this.accesoTemporal(id);
  }

  private async accesoTemporal(id: string) {
    return vistaAcceso(await this.bd.tx().accesoClinicoTemporal.findUniqueOrThrow({ where: { id }, include: { revocacion: true } }));
  }

  /** Ultima y proxima sesion y sesiones sin cerrar (metadata, sin contenido clinico). */
  estadoFichas(profesionalId: string) {
    return this.bd.tx().$queryRaw<
      { paciente_id: string; ultima_sesion: Date | null; proxima_sesion: Date | null; sesiones_sin_cerrar: number; alta_en: Date | null }[]
    >`SELECT * FROM estado_fichas_profesional(${profesionalId}::uuid)`;
  }

  /**
   * Pendientes de las fichas (sin evolucion, consentimiento, RUT, adulto
   * responsable): metadata y codigo seudonimo. ADMIN/GESTION todos o uno; el
   * profesional o practicante, los propios (lo decide la BD).
   */
  pendientesFichas(profesionalId?: string) {
    return this.bd.tx().$queryRaw<PendienteFicha[]>`SELECT * FROM pendientes_fichas(${profesionalId ?? null}::uuid) ORDER BY fecha NULLS LAST`;
  }
}
