import { Injectable } from '@nestjs/common';
import type { EstadoCita, ModalidadAtencion } from '@prisma/client';

export interface EventoCalendario {
  /** Fijo por cita: una reprogramacion o cancelacion actualiza el mismo evento. */
  uid: string;
  /** SEQUENCE (RFC 5545): sube con cada cambio de la cita (citas.secuencia). */
  secuencia: number;
  inicio: Date;
  fin: Date;
  titulo: string;
  ubicacion: string | null;
  descripcion: string | null;
  estado: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

export interface OpcionesCalendario {
  /** PUBLISH (feed y avisos) o CANCEL (cita cancelada). */
  metodo?: 'PUBLISH' | 'CANCEL';
  /** Remitente de la plataforma con el nombre del centro (adjuntos de correo). */
  organizador?: { nombre: string; email: string };
}

/**
 * Calendario (docs/api/integraciones.md): arma iCalendar (RFC 5545) para el
 * feed privado y los adjuntos .ics. Los modulos solo conocen esta interfaz;
 * un adaptador opcional (p. ej. Google Calendar) la implementaria empujando
 * los mismos eventos.
 */
export abstract class ProveedorCalendario {
  abstract calendario(nombre: string, eventos: EventoCalendario[], opciones?: OpcionesCalendario): string;
}

/** Datos de una cita que pueden salir del sistema (nunca paciente ni motivo). */
export interface CitaCalendario {
  id: string;
  inicio: Date;
  fin: Date;
  modalidad: ModalidadAtencion;
  estado: EstadoCita;
  espacio: string | null;
  enlace: string | null;
  secuencia: number;
}

/**
 * Regla de contenido unica para el feed y los .ics: solo "Sesion", la
 * modalidad, el horario y el enlace o el box. POR_REPROGRAMAR va marcada
 * (tentativa); CANCELADA, STATUS:CANCELLED. UID fijo por cita y SEQUENCE de
 * la BD: los clientes actualizan el evento existente. Nunca el nombre del
 * paciente ni el motivo.
 */
export function eventoDeCita(c: CitaCalendario): EventoCalendario {
  const porReprogramar = c.estado === 'POR_REPROGRAMAR';
  return {
    uid: `${c.id}@vinculos`,
    secuencia: c.secuencia,
    inicio: c.inicio,
    fin: c.fin,
    titulo: porReprogramar ? 'Sesión (por reprogramar)' : 'Sesión',
    ubicacion: c.estado === 'CANCELADA' ? null : c.modalidad === 'ONLINE' ? c.enlace : c.espacio,
    descripcion: `Modalidad: ${c.modalidad === 'ONLINE' ? 'online' : 'presencial'}`,
    estado: c.estado === 'CANCELADA' ? 'CANCELLED' : porReprogramar ? 'TENTATIVE' : 'CONFIRMED',
  };
}

const fecha = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const escapar = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliega lineas a 75 octetos (RFC 5545 3.1). */
function plegar(linea: string): string {
  const partes: string[] = [];
  let actual = '';
  for (const ch of linea) {
    if (Buffer.byteLength(actual + ch) > (partes.length ? 74 : 75)) {
      partes.push(actual);
      actual = '';
    }
    actual += ch;
  }
  partes.push(actual);
  return partes.join('\r\n ');
}

@Injectable()
export class CalendarioIcs extends ProveedorCalendario {
  calendario(nombre: string, eventos: EventoCalendario[], opciones: OpcionesCalendario = {}): string {
    const ahora = fecha(new Date());
    const org = opciones.organizador;
    const lineas = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Vinculos//Agenda//ES',
      'CALSCALE:GREGORIAN',
      `METHOD:${opciones.metodo ?? 'PUBLISH'}`,
      `X-WR-CALNAME:${escapar(nombre)}`,
      ...eventos.flatMap((e) => [
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `SEQUENCE:${e.secuencia}`,
        `DTSTAMP:${ahora}`,
        ...(org ? [`ORGANIZER;CN="${org.nombre.replace(/"/g, '')}":mailto:${org.email}`] : []),
        `DTSTART:${fecha(e.inicio)}`,
        `DTEND:${fecha(e.fin)}`,
        `SUMMARY:${escapar(e.titulo)}`,
        ...(e.ubicacion ? [`LOCATION:${escapar(e.ubicacion)}`] : []),
        ...(e.descripcion ? [`DESCRIPTION:${escapar(e.descripcion)}`] : []),
        `STATUS:${e.estado}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ];
    return lineas.map(plegar).join('\r\n') + '\r\n';
  }
}
