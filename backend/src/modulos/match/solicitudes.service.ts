import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EstadoCita, ModalidadAtencion, ModoVideollamada, Rol } from '@prisma/client';

import { HORA, hashToken, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { ProveedorVideollamada } from '../../core/integraciones/videollamada';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import type { SolicitudHoraDto } from './dto/match.dto';
import type { SolicitudCreada, SolicitudVerificada } from './dto/publico-respuestas.dto';

interface FilaSolicitud {
  id: string;
  telefono: Uint8Array | null;
  rut: Uint8Array | null;
  adulto_telefono: Uint8Array | null;
  adulto_nombre: string | null;
}

interface Concretada {
  paciente_id: string;
  cita_id: string;
  estado: EstadoCita;
  modalidad: ModalidadAtencion;
  profesional_id: string;
  inicio: Date;
  fin: Date;
  invitacion_email: string | null;
  invitacion_rol: Rol | null;
  sala_modo: ModoVideollamada | null;
  sala_enlace: Uint8Array | null;
}

/**
 * Solicitud de hora sin cuenta (D-2, D-3, C-15). Sin contexto RLS: todo pasa
 * por funciones de la BD diseñadas para el portal publico.
 *
 * 1. crear: valida y retiene la hora (bloqueos_temporales, 30 min por
 *    defecto); guarda datos y respuestas del match cifrados con el id de la
 *    solicitud; envia el enlace de verificacion. Rate limit por IP (publico),
 *    maximo de solicitudes pendientes por correo (BD) y trampa para bots.
 * 2. verificar: el enlace del correo concreta la solicitud (paciente con su
 *    ficha, cita CONFIRMADA o SOLICITADA, aceptaciones de politicas) y, si
 *    quedo confirmada, invita a crear la cuenta. Los datos se descifran con
 *    el AAD de la solicitud y se vuelven a cifrar con el del paciente.
 */
@Injectable()
export class SolicitudesService {
  private readonly logger = new Logger('Solicitudes');

  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
    private readonly video: ProveedorVideollamada,
    private readonly config: ConfigService,
  ) {}

  async crear(dto: SolicitudHoraDto): Promise<SolicitudCreada> {
    if (dto.sitioWeb) {
      // Bot: misma respuesta, sin efectos.
      this.logger.warn('Solicitud descartada por la trampa para bots');
      return { expiraEn: new Date(Date.now() + 30 * 60_000), verificacionEnviada: true };
    }
    if (dto.fin <= dto.inicio) {
      throw new BadRequestException('fin debe ser posterior a inicio');
    }
    const id = randomUUID();
    const c = (valor: string | undefined, columna: string) => (valor ? this.llavero.cifrarCampo(valor, 'solicitudes_hora', columna, id) : null);
    const { token, hash } = nuevoTokenCorreo();
    const [{ expira }] = await this.bd.sinContexto('publico').$queryRaw<[{ expira: Date }]>`
      SELECT crear_solicitud_hora(
        ${id}::uuid, ${dto.profesionalId}::uuid, ${dto.modalidad}::modalidad_atencion, ${dto.inicio}, ${dto.fin},
        ${dto.nombre}, ${dto.apellido}, ${dto.fechaNacimiento}::date, ${dto.email}, ${c(dto.telefono, 'telefono')},
        ${c(dto.rut, 'rut')}, ${dto.rut ? Buffer.from(this.llavero.hmacRut(dto.rut)) : null}, ${dto.adultoNombre ?? null},
        ${dto.adultoParentesco ?? null}, ${c(dto.adultoTelefono, 'adulto_telefono')},
        ${dto.respuestas ? c(JSON.stringify(dto.respuestas), 'respuestas') : null}, ${dto.recomendadoId ?? null}::uuid,
        ${dto.politicaId}::uuid, ${dto.terminosId ?? null}::uuid, ${hash}) AS expira`;
    await this.correos.enviar('VERIFICACION_SOLICITUD', dto.email, token, expira);
    return { expiraEn: expira, verificacionEnviada: true };
  }

  async verificar(token: string): Promise<SolicitudVerificada> {
    const hash = hashToken(token);
    const db = this.bd.sinContexto('publico');
    const [s] = await db.$queryRaw<FilaSolicitud[]>`SELECT id, telefono, rut, adulto_telefono, adulto_nombre FROM datos_solicitud_hora(${hash})`;
    if (!s) {
      throw new NotFoundException('Enlace inexistente, usado o vencido: pida la hora de nuevo');
    }
    const d = (valor: Uint8Array | null, columna: string) => this.llavero.descifrarCampo(valor, 'solicitudes_hora', columna, s.id);
    const telefono = d(s.telefono, 'telefono');
    const rut = d(s.rut, 'rut');
    const adultoTelefono = d(s.adulto_telefono, 'adulto_telefono');
    const pacienteId = randomUUID();
    const adultoId = randomUUID();
    const invitacion = nuevoTokenCorreo();
    const venceInvitacion = new Date(Date.now() + 72 * HORA);

    const r = await db.$transaction(async (tx) => {
      const [fila] = await tx.$queryRaw<Concretada[]>`
        SELECT * FROM concretar_solicitud_hora(
          ${hash}, ${pacienteId}::uuid, ${adultoId}::uuid,
          ${telefono ? this.llavero.cifrarCampo(telefono, 'pacientes', 'telefono', pacienteId) : null},
          ${rut ? this.llavero.cifrarCampo(rut, 'pacientes', 'rut', pacienteId) : null},
          ${rut ? Buffer.from(this.llavero.hmacRut(rut)) : null},
          ${adultoTelefono ? this.llavero.cifrarCampo(adultoTelefono, 'adultos_responsables', 'telefono', adultoId) : null},
          ${invitacion.hash}, ${venceInvitacion})`;
      if (fila.modalidad === 'ONLINE') {
        // Enlace de videollamada de la cita recien creada (mismo modo que una cita agendada por el equipo).
        const sala = await this.video.crearSala({
          citaId: fila.cita_id,
          inicio: fila.inicio,
          fin: fila.fin,
          expiraEn: new Date(fila.fin.getTime() + this.config.getOrThrow<number>('ENLACE_ONLINE_HORAS_TRAS_FIN') * HORA),
          modo: fila.sala_modo ?? 'ENLACE_PROPIO',
          enlacePropio: this.llavero.descifrarCampo(fila.sala_enlace, 'salas_videollamada', 'enlace', fila.profesional_id),
        });
        const enlace = JSON.stringify({ url: sala.url, expiraEn: sala.expiraEn.toISOString() });
        await tx.$executeRaw`
          SELECT guardar_enlace_solicitud(${fila.cita_id}::uuid, ${this.llavero.cifrarCampo(enlace, 'citas', 'enlace_online', fila.cita_id)})`;
      }
      return fila;
    });
    if (r.invitacion_email) {
      await this.correos.enviar('INVITACION', r.invitacion_email, invitacion.token, venceInvitacion);
    }
    return {
      estado: r.estado,
      citaId: r.cita_id,
      profesionalId: r.profesional_id,
      modalidad: r.modalidad,
      inicio: r.inicio,
      fin: r.fin,
      /** La cuenta se crea por invitacion (al correo verificado); SOLICITADA espera la aprobacion del profesional. */
      invitacionEnviada: !!r.invitacion_email,
      adultoResponsable: !!s.adulto_nombre,
    };
  }
}
