import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EstadoCita, ModalidadAtencion, ModoVideollamada, Rol } from '@prisma/client';

import { HORA, nuevoTokenCorreo } from '../auth/tokens-correo';
import type { Tx } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { ProveedorVideollamada } from '../integraciones/videollamada';
import { CorreosCuenta } from '../notificaciones/correos-cuenta';

/** Datos cifrados de la solicitud (AAD de solicitudes_hora con su id). */
export interface DatosSolicitud {
  id: string;
  telefono: Uint8Array | null;
  rut: Uint8Array | null;
  adulto_telefono: Uint8Array | null;
}

interface Fila {
  paciente_id: string | null;
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

export interface Concrecion {
  pacienteId: string | null;
  citaId: string;
  /** CONFIRMADA; LIBERADA si se pago pero la hora ya no se podia mantener (devolucion). */
  estado: EstadoCita;
  modalidad: ModalidadAtencion;
  profesionalId: string;
  inicio: Date;
  fin: Date;
  invitacion: { email: string; token: string; vence: Date } | null;
}

/**
 * 03b-3.2: concretar la reserva sin cuenta (paciente con su ficha, adulto
 * responsable, aceptaciones y la cita CONFIRMADA) con la regla de la BD
 * (concretar_reserva). Dos gatillos: el pago registrado (Cobros: webhook o
 * transferencia validada, en la misma transaccion) o el enlace del correo
 * cuando se paga en el centro (Match). Vive en el nucleo porque la usan los
 * dos modulos y ninguno importa al otro.
 *
 * Los datos se descifran con el AAD de la solicitud y se vuelven a cifrar con
 * el del paciente (ids generados aqui). La invitacion a la cuenta se envia
 * despues del COMMIT (enviarInvitacion). Nunca se loguean datos descifrados.
 */
@Injectable()
export class ConcrecionReserva {
  constructor(
    private readonly llavero: LlaveroService,
    private readonly video: ProveedorVideollamada,
    private readonly config: ConfigService,
    private readonly correos: CorreosCuenta,
  ) {}

  /** Tras registrar un pago en `tx`: concreta si la cita es una reserva pagada sin paciente; si no, null. */
  async trasPago(tx: Tx, citaId: string): Promise<Concrecion | null> {
    const [s] = await tx.$queryRaw<DatosSolicitud[]>`
      SELECT solicitud_id AS id, telefono, rut, adulto_telefono FROM reserva_por_concretar(${citaId}::uuid)`;
    return s ? this.concretar(tx, s, citaId, null) : null;
  }

  /** Enlace del correo (pago en el centro o nada que cobrar). */
  conCorreo(tx: Tx, s: DatosSolicitud, tokenHash: Buffer): Promise<Concrecion> {
    return this.concretar(tx, s, null, tokenHash);
  }

  async enviarInvitacion(c: Concrecion | null): Promise<void> {
    if (c?.invitacion) {
      await this.correos.enviar('INVITACION', c.invitacion.email, c.invitacion.token, c.invitacion.vence);
    }
  }

  private async concretar(tx: Tx, s: DatosSolicitud, citaId: string | null, tokenHash: Buffer | null): Promise<Concrecion> {
    const d = (valor: Uint8Array | null, columna: string) => this.llavero.descifrarCampo(valor, 'solicitudes_hora', columna, s.id);
    const telefono = d(s.telefono, 'telefono');
    const rut = d(s.rut, 'rut');
    const adultoTelefono = d(s.adulto_telefono, 'adulto_telefono');
    const pacienteId = randomUUID();
    const adultoId = randomUUID();
    const invitacion = nuevoTokenCorreo();
    const venceInvitacion = new Date(Date.now() + 72 * HORA);

    const [f] = await tx.$queryRaw<Fila[]>`
      SELECT * FROM concretar_reserva(
        ${citaId}::uuid, ${tokenHash}::bytea, ${pacienteId}::uuid, ${adultoId}::uuid,
        ${telefono ? this.llavero.cifrarCampo(telefono, 'pacientes', 'telefono', pacienteId) : null}::bytea,
        ${rut ? this.llavero.cifrarCampo(rut, 'pacientes', 'rut', pacienteId) : null}::bytea,
        ${rut ? Buffer.from(this.llavero.hmacRut(rut)) : null}::bytea,
        ${adultoTelefono ? this.llavero.cifrarCampo(adultoTelefono, 'adultos_responsables', 'telefono', adultoId) : null}::bytea,
        ${invitacion.hash}, ${venceInvitacion})`;
    if (f.estado === 'CONFIRMADA' && f.modalidad === 'ONLINE') {
      // Enlace de videollamada de la cita (mismo modo que una cita agendada por el equipo).
      const sala = await this.video.crearSala({
        citaId: f.cita_id,
        inicio: f.inicio,
        fin: f.fin,
        expiraEn: new Date(f.fin.getTime() + this.config.getOrThrow<number>('ENLACE_ONLINE_HORAS_TRAS_FIN') * HORA),
        modo: f.sala_modo ?? 'ENLACE_PROPIO',
        enlacePropio: this.llavero.descifrarCampo(f.sala_enlace, 'salas_videollamada', 'enlace', f.profesional_id),
      });
      const enlace = JSON.stringify({ url: sala.url, expiraEn: sala.expiraEn.toISOString() });
      await tx.$executeRaw`
        SELECT guardar_enlace_solicitud(${f.cita_id}::uuid, ${this.llavero.cifrarCampo(enlace, 'citas', 'enlace_online', f.cita_id)})`;
    }
    return {
      pacienteId: f.paciente_id,
      citaId: f.cita_id,
      estado: f.estado,
      modalidad: f.modalidad,
      profesionalId: f.profesional_id,
      inicio: f.inicio,
      fin: f.fin,
      invitacion: f.invitacion_email ? { email: f.invitacion_email, token: invitacion.token, vence: venceInvitacion } : null,
    };
  }
}
