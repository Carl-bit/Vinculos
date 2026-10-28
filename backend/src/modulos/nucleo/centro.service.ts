import { Injectable } from '@nestjs/common';
import { Prisma, type TipoPolitica } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { procesarImagenPublica } from '../../core/imagenes/imagenes';
import { ModulosGuard } from '../../core/modulos/modulos';
import type { BloqueHorarioDto, ContenidoPublicoDto } from './dto/nucleo.dto';

/**
 * Datos del centro (03a): modulos contratados, contenido de la pagina
 * publica, politicas versionadas, horario general y dashboard por rol.
 */
@Injectable()
export class CentroService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly modulosGuard: ModulosGuard,
  ) {}

  async modulos() {
    return { activos: await this.modulosGuard.activos() };
  }

  contenido() {
    return this.bd.tx().contenidoPublico.findUniqueOrThrow({ where: { id: true } });
  }

  editarContenido(dto: ContenidoPublicoDto) {
    const { servicios, ...resto } = dto;
    return this.bd.tx().contenidoPublico.update({
      where: { id: true },
      data: { ...resto, servicios: servicios === undefined ? undefined : (servicios as unknown as Prisma.InputJsonValue) },
    });
  }

  /** Logo (ADMIN): imagen publica procesada (sin metadatos) y enlazada al contenido. */
  async subirLogo(archivo: Buffer) {
    const img = await procesarImagenPublica(archivo);
    const tx = this.bd.tx();
    const { id } = await tx.imagenPublica.create({
      data: {
        tipo: 'LOGO',
        tipoMime: img.tipoMime,
        ancho: img.ancho,
        alto: img.alto,
        tamanoBytes: img.contenido.length,
        contenido: new Uint8Array(img.contenido),
      },
      select: { id: true },
    });
    await tx.contenidoPublico.update({ where: { id: true }, data: { logoImagenId: id } });
    return { logoImagenId: id, url: `/api/publico/imagenes/${id}` };
  }

  politicas() {
    return this.bd.tx().politica.findMany({ orderBy: [{ tipo: 'asc' }, { version: 'desc' }] });
  }

  /** Version nueva (la BD fija la version y la fecha; nunca se edita una anterior). */
  publicarPolitica(tipo: TipoPolitica, texto: string) {
    return this.bd.tx().politica.create({ data: { tipo, version: 0, texto } });
  }

  /** 03b-4.2: protocolo interno vigente y la lectura de la cuenta (equipo). */
  async protocoloEquipo() {
    const tx = this.bd.tx();
    const vigente = await this.protocoloVigente();
    const lectura = vigente
      ? await tx.lecturaProtocolo.findUnique({
          where: { politicaId_usuarioId: { politicaId: vigente.id, usuarioId: this.bd.usuario().id } },
          select: { leidoEn: true },
        })
      : null;
    return { vigente, leidoEn: lectura?.leidoEn ?? null };
  }

  /** "Lo lei" de la version vigente (idempotente: devuelve la primera lectura). */
  async marcarProtocoloLeido() {
    const [{ leido }] = await this.bd.tx().$queryRaw<[{ leido: Date }]>`SELECT marcar_protocolo_leido() AS leido`;
    return { leidoEn: leido };
  }

  /** ADMIN/GESTION: quien leyo la version vigente (los que faltan los cruza el panel con el directorio). */
  async lecturasProtocolo() {
    const vigente = await this.protocoloVigente();
    if (!vigente) {
      return [];
    }
    return this.bd.tx().lecturaProtocolo.findMany({
      where: { politicaId: vigente.id },
      orderBy: { leidoEn: 'asc' },
      select: { usuarioId: true, rol: true, leidoEn: true },
    });
  }

  private async protocoloVigente() {
    const [v] = await this.bd.tx().$queryRaw<{ id: string; version: number; texto: string; vigente_desde: Date }[]>`
      SELECT * FROM politica_vigente('PROTOCOLO_EQUIPO'::tipo_politica)`;
    return v ? { id: v.id, version: v.version, texto: v.texto, vigenteDesde: v.vigente_desde } : null;
  }

  horario() {
    return this.bd.tx().horarioCentro.findMany({ orderBy: [{ diaSemana: 'asc' }, { inicioMin: 'asc' }] });
  }

  /** Reemplaza el horario del centro (no mueve citas ya agendadas; las nuevas deben caer dentro). */
  async reemplazarHorario(bloques: BloqueHorarioDto[]) {
    const tx = this.bd.tx();
    await tx.horarioCentro.deleteMany({});
    await tx.horarioCentro.createMany({ data: bloques });
    return this.horario();
  }

  /** Agregados por rol (reporte_dashboard): sin datos clinicos para ADMIN/GESTION. */
  async dashboard() {
    const [{ r }] = await this.bd.tx().$queryRaw<[{ r: Record<string, unknown> }]>`SELECT reporte_dashboard() AS r`;
    return { ...r, modulos: await this.modulosGuard.activos() };
  }
}
