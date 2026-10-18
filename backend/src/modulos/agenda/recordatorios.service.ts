import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ModalidadAtencion, RespuestaRecordatorio } from '@prisma/client';

import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { JobsService, type ResultadoJob } from '../../core/jobs/jobs.service';

const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');

/**
 * Recordatorios de citas (02i). El job (sin contexto, advisory lock) toma las
 * citas confirmadas que entran en la ventana (configuracion_centro.
 * recordatorio_horas_antes; 0 = desactivado) y registra un recordatorio por
 * cita y horario (UNIQUE: una sola vez; si se reprograma, otro). Cada uno
 * lleva un token de 256 bits de un solo uso, valido hasta el inicio de la
 * cita: la BD guarda su SHA-256 y la URL cifrada (para armar el mensaje). El
 * mensaje respeta las preferencias del paciente (encolar_notificacion).
 *
 * Con el token, sin sesion: ver la cita y la politica que aplicaria si
 * cancela (a tiempo o tardia) y luego confirmar asistencia o cancelar.
 */
@Injectable()
export class RecordatoriosService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly jobs: JobsService,
    private readonly llavero: LlaveroService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'enviar_recordatorios' })
  enviarRecordatorios(): Promise<ResultadoJob> {
    return this.jobs.conLock('enviar_recordatorios', async (tx) => {
      const citas = await tx.$queryRaw<{ cita_id: string; inicio: Date }[]>`SELECT * FROM citas_por_recordar(200)`;
      const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
      let registrados = 0;
      for (const c of citas) {
        const id = randomUUID();
        const token = randomBytes(32).toString('base64url');
        const enlace = this.llavero.cifrarCampo(`${base}/recordatorio?token=${token}`, 'recordatorios_cita', 'enlace', id);
        const [{ ok }] = await tx.$queryRaw<[{ ok: boolean }]>`
          SELECT registrar_recordatorio(${id}::uuid, ${c.cita_id}::uuid, ${c.inicio}::timestamptz, ${sha256(token)}, ${enlace}) AS ok`;
        registrados += ok ? 1 : 0;
      }
      return registrados;
    });
  }

  /** Lo que el paciente ve antes de responder; token inexistente -> 404. */
  async consultar(token: string) {
    const [r] = await this.bd.sinContexto('publico').$queryRaw<
      {
        inicio: Date;
        fin: Date;
        modalidad: ModalidadAtencion;
        profesional: string | null;
        respuesta: RespuestaRecordatorio | null;
        vigente: boolean;
        a_tiempo: boolean;
        plazo_aviso_horas: number;
        penalizacion_porcentaje: string;
      }[]
    >`SELECT * FROM consultar_recordatorio(${sha256(token)})`;
    const c = encontrado(r, 'Recordatorio');
    return {
      inicio: c.inicio,
      fin: c.fin,
      modalidad: c.modalidad,
      profesional: c.profesional,
      respuesta: c.respuesta,
      vigente: c.vigente,
      /** Si cancela ahora: a tiempo (sin cargo) o tardia (penalizacion sobre lo pagado). */
      cancelacion: { aTiempo: c.a_tiempo, plazoAvisoHoras: c.plazo_aviso_horas, penalizacionPorcentaje: Number(c.penalizacion_porcentaje) },
    };
  }

  /** Un solo uso: segunda respuesta, enlace vencido o cita ya cambiada -> 409. */
  async responder(token: string, respuesta: RespuestaRecordatorio) {
    const [r] = await this.bd.sinContexto('publico').$queryRaw<
      { respuesta: RespuestaRecordatorio; a_tiempo: boolean | null; penalizacion_porcentaje: string }[]
    >`SELECT * FROM responder_recordatorio(${sha256(token)}, ${respuesta}::respuesta_recordatorio)`;
    return {
      respuesta: r.respuesta,
      ...(r.a_tiempo === null ? {} : { cancelacion: { aTiempo: r.a_tiempo, penalizacionPorcentaje: Number(r.penalizacion_porcentaje) } }),
    };
  }
}
