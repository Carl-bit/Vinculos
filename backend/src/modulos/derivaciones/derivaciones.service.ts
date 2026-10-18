import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EstadoDerivacion, TipoNotificacion } from '@prisma/client';

import { texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';
import type { CrearDerivacionDto, ResponderAvisoDto, ResponderConsentimientoDto, RevocarConsentimientoDto } from './dto/derivaciones.dto';

/**
 * Derivaciones y consentimientos: TODA escritura via funciones SECURITY
 * DEFINER (sin GRANT directo). La API genera el id de la derivacion y cifra
 * motivo/detalle con ese id (AAD derivaciones:<col>:<id>) antes de llamar a
 * crear_derivacion. Las funciones que devuelven columnas cifradas se
 * descifran aqui con el AAD de la fila de origen.
 *
 * Avisos (02h): los registra la BD con triggers sobre derivacion_candidatos y
 * derivaciones, tambien cuando un job o un rechazo pasa la oferta al
 * siguiente: el candidato recibe solo "tiene una oferta" (sin quien la
 * origino); el profesional de origen, un aviso por cambio de estado.
 */
@Injectable()
export class DerivacionesService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly eventos: EventEmitter2,
  ) {}

  /** Tratante (PROFESIONAL), o de oficio ADMIN / supervisor si el paciente esta en la bandeja. */
  async crear(dto: CrearDerivacionDto) {
    const id = randomUUID();
    const motivo = this.llavero.cifrarCampo(dto.motivo, 'derivaciones', 'motivo', id);
    const detalle = dto.detalle ? this.llavero.cifrarCampo(dto.detalle, 'derivaciones', 'detalle', id) : null;
    await this.bd.tx().$queryRaw`
      SELECT crear_derivacion(${id}::uuid, ${dto.fichaId}::uuid, ${motivo}, ${dto.tipoAtencionId}::uuid,
                              ${detalle}::bytea, ${dto.candidatos}::uuid[])`;
    // De oficio el supervisor no ve la derivacion (origen = tratante saliente): solo el id.
    return { id };
  }

  /** ADMIN todas; PROFESIONAL las que origino o de fichas que trata (RLS). */
  async listar(estado?: EstadoDerivacion) {
    const filas = await this.bd.tx().derivacion.findMany({
      where: estado ? { estado } : {},
      include: { candidatos: { select: { profesionalId: true, orden: true, estado: true, venceEn: true } } },
      orderBy: { fecha: 'desc' },
    });
    return filas.map((d) => ({ ...d, motivo: texto(d.motivo), detalle: texto(d.detalle) }));
  }

  async obtener(id: string) {
    const d = encontrado(
      await this.bd.tx().derivacion.findUnique({
        where: { id },
        include: { candidatos: { select: { profesionalId: true, orden: true, estado: true, venceEn: true }, orderBy: { orden: 'asc' } } },
      }),
      'Derivacion',
    );
    return { ...d, motivo: texto(d.motivo), detalle: texto(d.detalle) };
  }

  /** Bandeja de ADMIN y supervisores vigentes: motivo, edad y tipo (auditada por la funcion). */
  async pendientes() {
    const filas = await this.bd.tx().$queryRaw<
      { derivacion_id: string; estado: EstadoDerivacion; motivo: Uint8Array; detalle: Uint8Array | null; tipo_atencion: string; edad_paciente: number }[]
    >`SELECT * FROM derivaciones_pendientes()`;
    return filas.map((f) => ({
      derivacionId: f.derivacion_id,
      estado: f.estado,
      motivo: this.llavero.descifrarCampo(f.motivo, 'derivaciones', 'motivo', f.derivacion_id),
      detalle: this.llavero.descifrarCampo(f.detalle, 'derivaciones', 'detalle', f.derivacion_id),
      tipoAtencion: f.tipo_atencion,
      edadPaciente: f.edad_paciente,
    }));
  }

  /** Solo el candidato OFRECIDO; 0 filas -> 404 (no revela si existe). */
  async oferta(id: string) {
    const [f] = await this.bd.tx().$queryRaw<
      {
        derivacion_id: string;
        motivo: Uint8Array;
        tipo_atencion: string;
        detalle: Uint8Array | null;
        edad_paciente: number;
        vence_en: Date;
        citas_en_conflicto: number;
      }[]
    >`SELECT * FROM oferta_derivacion(${id}::uuid)`;
    const oferta = encontrado(f, 'Oferta');
    return {
      derivacionId: oferta.derivacion_id,
      motivo: this.llavero.descifrarCampo(oferta.motivo, 'derivaciones', 'motivo', oferta.derivacion_id),
      detalle: this.llavero.descifrarCampo(oferta.detalle, 'derivaciones', 'detalle', oferta.derivacion_id),
      tipoAtencion: oferta.tipo_atencion,
      edadPaciente: oferta.edad_paciente,
      venceEn: oferta.vence_en,
      citasEnConflicto: oferta.citas_en_conflicto,
    };
  }

  /**
   * PROFESIONAL acepta: traspaso. PRACTICANTE acepta: ESPERANDO_CONSENTIMIENTO
   * + solicitud al paciente (se le notifica). Rechazo: siguiente candidato.
   */
  async responder(id: string, acepta: boolean) {
    const tx = this.bd.tx();
    const actor = this.bd.usuario();
    await tx.$executeRaw`SELECT responder_derivacion(${id}::uuid, ${acepta})`;
    if (acepta && actor.rol === 'PRACTICANTE') {
      const solicitud = await tx.consentimiento.findFirst({ where: { derivacionId: id, practicanteId: actor.id, estado: 'SOLICITADO' } });
      if (solicitud) {
        this.notificar('CONSENTIMIENTO_SOLICITADO', { pacienteId: solicitud.pacienteId }, solicitud.id);
      }
    }
    return { derivacionId: id, acepta };
  }

  async cancelar(id: string, motivo: string) {
    await this.bd.tx().$executeRaw`SELECT cancelar_derivacion(${id}::uuid, ${motivo})`;
    return this.obtener(id);
  }

  async definirCandidatos(id: string, candidatos: string[]) {
    await this.bd.tx().$executeRaw`SELECT definir_candidatos_derivacion(${id}::uuid, ${candidatos}::uuid[])`;
    return this.obtener(id);
  }

  async reintegrar(id: string, profesionalId: string) {
    await this.bd.tx().$executeRaw`SELECT reintegrar_candidato(${id}::uuid, ${profesionalId}::uuid)`;
    return this.obtener(id);
  }

  /** ADMIN o el supervisor vigente del practicante (lo agrega al final). */
  async proponerPracticante(id: string, practicanteId: string) {
    await this.bd.tx().$executeRaw`SELECT proponer_practicante(${id}::uuid, ${practicanteId}::uuid)`;
    return { derivacionId: id, practicanteId };
  }

  consentimientos() {
    return this.bd.tx().consentimiento.findMany({ orderBy: { solicitadoEn: 'desc' } });
  }

  /** ADMIN o el supervisor vigente: nueva solicitud para el practicante tratante. */
  async solicitarConsentimiento(pacienteId: string) {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`SELECT solicitar_consentimiento(${pacienteId}::uuid) AS id`;
    this.notificar('CONSENTIMIENTO_SOLICITADO', { pacienteId }, id);
    return { id, pacienteId };
  }

  async responderConsentimiento(id: string, dto: ResponderConsentimientoDto) {
    await this.bd.tx().$executeRaw`
      SELECT responder_consentimiento(${id}::uuid, ${dto.acepta}, ${dto.versionDocumento ?? null},
                                      ${dto.otorgadoPorTipo}::otorgante_consentimiento, ${dto.adultoResponsableId ?? null}::uuid,
                                      ${dto.respaldoDocumentoRef ?? null})`;
    return encontrado(await this.bd.tx().consentimiento.findUnique({ where: { id } }), 'Consentimiento');
  }

  /** Corte inmediato: citas futuras con el practicante POR_REPROGRAMAR y bandeja. */
  async revocarConsentimiento(id: string, dto: RevocarConsentimientoDto) {
    await this.bd.tx().$executeRaw`
      SELECT revocar_consentimiento(${id}::uuid, ${dto.otorgadoPorTipo}::otorgante_consentimiento,
                                    ${dto.adultoResponsableId ?? null}::uuid, ${dto.respaldoDocumentoRef ?? null})`;
    return encontrado(await this.bd.tx().consentimiento.findUnique({ where: { id } }), 'Consentimiento');
  }

  avisos() {
    return this.bd.tx().avisoConsentimiento.findMany({ orderBy: { notificadoEn: 'desc' } });
  }

  /** OPOSICION = revocacion del consentimiento. */
  async responderAviso(id: string, dto: ResponderAvisoDto) {
    await this.bd.tx().$executeRaw`
      SELECT responder_aviso_consentimiento(${id}::uuid, ${dto.respuesta}::respuesta_aviso,
                                            ${dto.otorgadoPorTipo}::otorgante_consentimiento,
                                            ${dto.adultoResponsableId ?? null}::uuid, ${dto.respaldoDocumentoRef ?? null})`;
    return encontrado(await this.bd.tx().avisoConsentimiento.findUnique({ where: { id } }), 'Aviso');
  }

  private notificar(tipo: TipoNotificacion, destino: NotificacionSolicitada['destino'], referenciaId: string) {
    const evento: NotificacionSolicitada = { actor: this.bd.usuario(), tipo, destino, referenciaId };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
  }
}
