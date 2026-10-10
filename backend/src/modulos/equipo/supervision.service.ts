import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { NivelRiesgo } from '@prisma/client';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';

/**
 * Supervision de practicantes. Asignar y cambiar supervisor: solo ADMIN via
 * cambiar_supervisor() (cierra y abre en la misma transaccion: nunca hay un
 * practicante sin supervisor; no invalida consentimientos, crea avisos).
 *
 * Supervision seudonimizada: el supervisor ve casos por codigo y
 * evoluciones (campos estructurados + notas) via funciones que auditan; nunca
 * nombre, RUT, paciente_id ni ficha_id. Comentarios append-only; los lee el
 * tratante actual y el supervisor mientras supervise (RLS).
 */
@Injectable()
export class SupervisionService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly eventos: EventEmitter2,
  ) {}

  supervisiones() {
    return this.bd.tx().supervision.findMany({ orderBy: [{ practicanteId: 'asc' }, { desde: 'desc' }] });
  }

  /** Cada aviso creado se notifica al paciente (plazo de oposicion). */
  async cambiarSupervisor(practicanteId: string, supervisorId: string) {
    const tx = this.bd.tx();
    const [{ avisos }] = await tx.$queryRaw<[{ avisos: number }]>`
      SELECT cambiar_supervisor(${practicanteId}::uuid, ${supervisorId}::uuid) AS avisos`;
    const nuevos = await tx.avisoConsentimiento.findMany({
      where: { supervisorNuevoId: supervisorId, respuesta: 'SIN_RESPUESTA', consentimiento: { practicanteId } },
      select: { id: true, consentimiento: { select: { pacienteId: true } } },
    });
    const actor = this.bd.usuario();
    for (const aviso of nuevos) {
      const evento: NotificacionSolicitada = {
        actor,
        tipo: 'AVISO_CAMBIO_SUPERVISOR',
        destino: { pacienteId: aviso.consentimiento.pacienteId },
        referenciaId: aviso.id,
      };
      this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
    }
    return { practicanteId, supervisorId, avisosCreados: avisos };
  }

  casos() {
    return this.bd.tx().$queryRaw<{ codigo: string; practicante_id: string; edad_paciente: number; tipo_atencion: string | null }[]>`
      SELECT codigo, practicante_id, edad_paciente, tipo_atencion FROM supervision_casos()`;
  }

  /** 0 filas si el codigo no es un caso suyo (la funcion no distingue: no revela existencia). */
  async evoluciones(codigo: string) {
    const filas = await this.bd.tx().$queryRaw<
      {
        evolucion_id: string;
        autor_id: string;
        tipo_sesion: string;
        intervenciones: string[];
        estado_avance: string | null;
        nivel_riesgo: NivelRiesgo;
        notas: Uint8Array;
        corrige_a_id: string | null;
        creado_en: Date;
      }[]
    >`SELECT * FROM supervision_evoluciones(${codigo})`;
    return filas.map((f) => ({
      evolucionId: f.evolucion_id,
      autorId: f.autor_id,
      tipoSesion: f.tipo_sesion,
      intervenciones: f.intervenciones,
      estadoAvance: f.estado_avance,
      nivelRiesgo: f.nivel_riesgo,
      notas: this.llavero.descifrarCampo(f.notas, 'evoluciones', 'notas', f.evolucion_id),
      corrigeAId: f.corrige_a_id,
      creadoEn: f.creado_en,
    }));
  }

  /** Solo el supervisor vigente del practicante autor (RLS: 42501 -> 403). */
  async comentar(evolucionId: string, textoComentario: string) {
    const c = await this.bd.tx().supervisionComentario.create({
      data: { id: randomUUID(), evolucionId, supervisorId: this.bd.usuario().id, texto: claro(textoComentario) },
    });
    return { id: c.id, evolucionId: c.evolucionId, supervisorId: c.supervisorId, texto: texto(c.texto), creadoEn: c.creadoEn };
  }

  async comentarios(evolucionId: string) {
    const filas = await this.bd.tx().supervisionComentario.findMany({ where: { evolucionId }, orderBy: { creadoEn: 'asc' } });
    return filas.map((c) => ({ id: c.id, evolucionId: c.evolucionId, supervisorId: c.supervisorId, texto: texto(c.texto), creadoEn: c.creadoEn }));
  }

  /** Para reportar 404 en vez de una lista vacia cuando la evolucion no es visible. */
  async exigirEvolucionVisible(evolucionId: string) {
    const visible = await this.bd.tx().$queryRaw<{ ok: boolean }[]>`
      SELECT (EXISTS (SELECT 1 FROM evoluciones WHERE id = ${evolucionId}::uuid) OR evolucion_supervisable(${evolucionId}::uuid)) AS ok`;
    encontrado(visible[0]?.ok || null, 'Evolucion');
  }
}
