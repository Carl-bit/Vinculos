import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EstadoCita, ModalidadAtencion, Rol } from '@prisma/client';

import { HORA, nuevoTokenCorreo } from '../auth/tokens-correo';
import type { Tx } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { CorreosCuenta } from '../notificaciones/correos-cuenta';

/** Datos cifrados de la solicitud (AAD de solicitudes_hora con su id). */
export interface DatosSolicitud {
  id: string;
  telefono: Uint8Array | null;
  rut: Uint8Array | null;
  adulto_telefono: Uint8Array | null;
}

interface Fila {
  paciente_id: string;
  cita_id: string;
  estado: EstadoCita;
  modalidad: ModalidadAtencion;
  profesional_id: string;
  inicio: Date;
  fin: Date;
  invitacion_email: string | null;
  invitacion_rol: Rol | null;
}

export interface Concrecion {
  pacienteId: string;
  citaId: string;
  /** SOLICITADA: la hora pasa a su profesional, que la aprueba o propone otras. */
  estado: EstadoCita;
  modalidad: ModalidadAtencion;
  profesionalId: string;
  inicio: Date;
  fin: Date;
  invitacion: { email: string; token: string; vence: Date } | null;
}

/**
 * 03b-3.2: concretar la reserva sin cuenta con la regla de la BD
 * (concretar_reserva). MVP sin cobros (2026-11-16): el unico gatillo es el
 * enlace del correo; nace el paciente con su ficha, adulto responsable y
 * aceptaciones, y la cita queda SOLICITADA hasta que la aprueba su
 * profesional (el enlace de videollamada sale al aprobarla).
 *
 * Los datos se descifran con el AAD de la solicitud y se vuelven a cifrar con
 * el del paciente (ids generados aqui). La invitacion a la cuenta se envia
 * despues del COMMIT (enviarInvitacion). Nunca se loguean datos descifrados.
 */
@Injectable()
export class ConcrecionReserva {
  constructor(
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
  ) {}

  async conCorreo(tx: Tx, s: DatosSolicitud, tokenHash: Buffer): Promise<Concrecion> {
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
        ${tokenHash}::bytea, ${pacienteId}::uuid, ${adultoId}::uuid,
        ${telefono ? this.llavero.cifrarCampo(telefono, 'pacientes', 'telefono', pacienteId) : null}::bytea,
        ${rut ? this.llavero.cifrarCampo(rut, 'pacientes', 'rut', pacienteId) : null}::bytea,
        ${rut ? Buffer.from(this.llavero.hmacRut(rut)) : null}::bytea,
        ${adultoTelefono ? this.llavero.cifrarCampo(adultoTelefono, 'adultos_responsables', 'telefono', adultoId) : null}::bytea,
        ${invitacion.hash}, ${venceInvitacion})`;
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

  async enviarInvitacion(c: Concrecion | null): Promise<void> {
    if (c?.invitacion) {
      await this.correos.enviar('INVITACION', c.invitacion.email, c.invitacion.token, c.invitacion.vence);
    }
  }
}
