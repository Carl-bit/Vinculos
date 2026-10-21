import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ModalidadAtencion } from '@prisma/client';

import { hashToken, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { esSqlstate } from '../../core/errores/sqlstate';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import { ConcrecionReserva, type DatosSolicitud } from '../../core/reservas/concrecion-reserva';
import type { SolicitudHoraDto } from './dto/match.dto';
import type { SolicitudCreada, SolicitudVerificada } from './dto/publico-respuestas.dto';

interface FilaSolicitud extends DatosSolicitud {
  adulto_nombre: string | null;
  profesional_id: string;
  modalidad: ModalidadAtencion;
  inicio: Date;
  fin: Date;
}

const DIA = 86_400_000;

/**
 * Solicitud de hora sin cuenta (D-2, D-3, C-15). Sin contexto RLS: todo pasa
 * por funciones de la BD diseñadas para el portal publico.
 *
 * 1. crear: valida y retiene la hora (03b-3.2: cita RETENIDA sin paciente,
 *    protegida por el EXCLUDE, por los minutos de retencion); guarda datos y
 *    respuestas del match cifrados con el id de la solicitud y entrega el
 *    token opaco de la reserva. El siguiente paso es pagar (Cobros); el
 *    enlace al correo sale solo si se paga en el centro (unico medio, nada
 *    que cobrar, o elegido despues en la reserva). Rate limit por IP
 *    (publico), maximo de reservas en curso por correo (BD) y trampa para bots.
 * 2. verificar: el enlace del correo concreta la reserva con pago en el
 *    centro (ConcrecionReserva: paciente con su ficha, cita CONFIRMADA,
 *    aceptaciones) e invita a crear la cuenta. Con la retencion vencida vale
 *    si la hora sigue libre; si no, 409 con horas cercanas.
 */
@Injectable()
export class SolicitudesService {
  private readonly logger = new Logger('Solicitudes');

  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
    private readonly concrecion: ConcrecionReserva,
  ) {}

  async crear(dto: SolicitudHoraDto): Promise<SolicitudCreada> {
    // 03b-3.1: token opaco de la reserva (estado consultable desde la pestaña; solo su hash va a la BD).
    const reserva = nuevoTokenCorreo();
    if (dto.sitioWeb) {
      // Bot: misma respuesta, sin efectos.
      this.logger.warn('Solicitud descartada por la trampa para bots');
      return { expiraEn: new Date(Date.now() + 30 * 60_000), verificacionEnviada: false, reserva: reserva.token };
    }
    if (dto.fin <= dto.inicio) {
      throw new BadRequestException('fin debe ser posterior a inicio');
    }
    const id = randomUUID();
    const c = (valor: string | undefined, columna: string) => (valor ? this.llavero.cifrarCampo(valor, 'solicitudes_hora', columna, id) : null);
    const { token, hash } = nuevoTokenCorreo();
    const [{ expira, verificar_correo }] = await this.bd.sinContexto('publico').$queryRaw<[{ expira: Date; verificar_correo: boolean }]>`
      SELECT expira, verificar_correo FROM crear_solicitud_hora(
        ${id}::uuid, ${dto.profesionalId}::uuid, ${dto.modalidad}::modalidad_atencion, ${dto.inicio}, ${dto.fin},
        ${dto.nombre}, ${dto.apellido}, ${dto.fechaNacimiento}::date, ${dto.email}, ${c(dto.telefono, 'telefono')},
        ${c(dto.rut, 'rut')}, ${dto.rut ? Buffer.from(this.llavero.hmacRut(dto.rut)) : null}, ${dto.adultoNombre ?? null},
        ${dto.adultoParentesco ?? null}, ${c(dto.adultoTelefono, 'adulto_telefono')},
        ${dto.respuestas ? c(JSON.stringify(dto.respuestas), 'respuestas') : null}, ${dto.recomendadoId ?? null}::uuid,
        ${dto.politicaId}::uuid, ${dto.terminosId ?? null}::uuid, ${hash}, ${reserva.hash})`;
    if (verificar_correo) {
      await this.correos.enviar('VERIFICACION_SOLICITUD', dto.email, token, expira);
    }
    return { expiraEn: expira, verificacionEnviada: verificar_correo, reserva: reserva.token };
  }

  async verificar(token: string): Promise<SolicitudVerificada> {
    const hash = hashToken(token);
    const db = this.bd.sinContexto('publico');
    const [s] = await db.$queryRaw<FilaSolicitud[]>`
      SELECT id, telefono, rut, adulto_telefono, adulto_nombre, profesional_id, modalidad, inicio, fin FROM datos_solicitud_hora(${hash})`;
    if (!s) {
      throw new NotFoundException('Enlace inexistente, usado o vencido: pida la hora de nuevo');
    }
    try {
      const r = await db.$transaction((tx) => this.concrecion.conCorreo(tx, s, hash));
      await this.concrecion.enviarInvitacion(r);
      return {
        estado: r.estado,
        citaId: r.citaId,
        profesionalId: r.profesionalId,
        modalidad: r.modalidad,
        inicio: r.inicio,
        fin: r.fin,
        /** La cuenta se crea por invitacion (al correo verificado). */
        invitacionEnviada: !!r.invitacion,
        adultoResponsable: !!s.adulto_nombre,
      };
    } catch (e) {
      // 03b-3.1: verificacion tardia con la hora ya tomada: 409 con horas cercanas.
      if (esSqlstate(e, '23P01')) {
        throw new ConflictException({
          message: 'La hora ya no esta disponible: elija otra',
          restriccion: 'solicitudes_hora_tomada',
          alternativas: await this.alternativas(s),
        });
      }
      throw e;
    }
  }

  /** Horas libres mas cercanas a la pedida, de la misma duracion y modalidad (dentro de 7 dias). */
  private async alternativas(s: FilaSolicitud): Promise<{ inicio: Date; fin: Date }[]> {
    const duracion = s.fin.getTime() - s.inicio.getTime();
    const desde = new Date(Math.max(Date.now(), s.inicio.getTime() - 7 * DIA));
    const hasta = new Date(desde.getTime() + 14 * DIA);
    const huecos = await this.bd.sinContexto('publico').$queryRaw<{ modalidad: ModalidadAtencion; inicio: Date; fin: Date }[]>`
      SELECT modalidad, inicio, fin FROM disponibilidad_publica(${s.profesional_id}::uuid, ${desde}, ${hasta})`;
    const paso = 15 * 60_000;
    const candidatas: number[] = [];
    for (const h of huecos.filter((x) => x.modalidad === s.modalidad)) {
      for (let t = Math.max(h.inicio.getTime(), Date.now()); t + duracion <= h.fin.getTime() && candidatas.length < 200; t += paso) {
        candidatas.push(t);
      }
    }
    const pedido = s.inicio.getTime();
    return candidatas
      .sort((a, b) => Math.abs(a - pedido) - Math.abs(b - pedido))
      .slice(0, 5)
      .sort((a, b) => a - b)
      .map((t) => ({ inicio: new Date(t), fin: new Date(t + duracion) }));
  }
}
