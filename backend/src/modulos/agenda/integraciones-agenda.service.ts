import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EstadoCita, ModalidadAtencion } from '@prisma/client';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { eventoDeCita, ProveedorCalendario } from '../../core/integraciones/calendario';
import type { SalaDto } from './dto/agenda.dto';

const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');

/**
 * Integraciones de la agenda (02h, docs/api/integraciones.md): sala de
 * videollamada del profesional y feed iCal privado. El feed se sirve sin
 * sesion (token en la URL, guardado como hash) y solo con la regla de
 * contenido de eventoDeCita: nunca paciente ni motivo.
 */
@Injectable()
export class IntegracionesAgendaService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly calendario: ProveedorCalendario,
    private readonly config: ConfigService,
  ) {}

  async miSala() {
    const sala = await this.bd.tx().salaVideollamada.findUnique({ where: { usuarioId: this.bd.usuario().id } });
    return { modo: sala?.modo ?? 'ENLACE_PROPIO', enlace: texto(sala?.enlace) };
  }

  async guardarMiSala(dto: SalaDto) {
    const usuarioId = this.bd.usuario().id;
    const datos = { modo: dto.modo, enlace: claro(dto.enlace ?? null) };
    const sala = await this.bd.tx().salaVideollamada.upsert({ where: { usuarioId }, create: { usuarioId, ...datos }, update: datos });
    return { modo: sala.modo, enlace: texto(sala.enlace) };
  }

  /** Token nuevo (se muestra una sola vez); el anterior deja de servir. */
  async regenerarFeed() {
    const usuarioId = this.bd.usuario().id;
    const token = randomBytes(32).toString('base64url');
    const datos = { tokenHash: sha256(token), creadoEn: new Date() };
    await this.bd.tx().feedCalendario.upsert({ where: { usuarioId }, create: { usuarioId, ...datos }, update: datos, select: { usuarioId: true } });
    const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    return { url: `${base}/api/calendario/${token}.ics` };
  }

  /** Sin contexto: feed_calendario(hash) solo responde para un token vigente (si no, P0002 -> 404). */
  async feed(token: string): Promise<string> {
    const filas = await this.bd.sinContexto('publico').$queryRaw<
      { id: string; inicio: Date; fin: Date; modalidad: ModalidadAtencion; estado: EstadoCita; espacio: string | null; enlace: Uint8Array | null }[]
    >`SELECT * FROM feed_calendario(${sha256(token.replace(/\.ics$/, ''))})`;
    const eventos = filas.map((c) =>
      eventoDeCita({ ...c, enlace: c.enlace ? (JSON.parse(this.llavero.descifrarCampo(c.enlace, 'citas', 'enlace_online', c.id)!) as { url: string }).url : null }),
    );
    return this.calendario.calendario('Agenda Vinculos', eventos);
  }
}
