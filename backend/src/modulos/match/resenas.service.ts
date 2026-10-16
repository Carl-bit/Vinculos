import { randomUUID } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import type { EstadoResena, MostrarResena } from '@prisma/client';

import { texto } from '../../core/bd/claro';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { CrearResenaDto, ResenaDto } from './dto/match.dto';

/**
 * Reseñas (D-1). Escritura solo via funciones de la BD (una por paciente y
 * profesional, con sesion realizada, moderacion previa, auditoria). Texto y
 * feedback privado se cifran aqui con el id de la reseña (AAD).
 */
@Injectable()
export class ResenasService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  private cifrar(id: string, dto: ResenaDto) {
    return {
      texto: dto.texto ? this.llavero.cifrarCampo(dto.texto, 'resenas', 'texto', id) : null,
      feedback: dto.feedbackPrivado ? this.llavero.cifrarCampo(dto.feedbackPrivado, 'resenas', 'feedback_privado', id) : null,
    };
  }

  /** Paciente adulto (su registro) o adulto responsable (el menor a cargo que indica). */
  async crear(dto: CrearResenaDto, pacienteId: string) {
    const id = randomUUID();
    const c = this.cifrar(id, dto);
    await this.bd.tx().$executeRaw`
      SELECT crear_resena(${id}::uuid, ${pacienteId}::uuid, ${dto.profesionalId}::uuid, ${dto.calificacion}::int, ${c.texto}, ${c.feedback},
                          ${dto.mostrarComo ?? 'ANONIMO'}::mostrar_resena)`;
    return this.obtener(id);
  }

  async editar(id: string, dto: ResenaDto) {
    const c = this.cifrar(id, dto);
    await this.bd.tx().$executeRaw`
      SELECT editar_resena(${id}::uuid, ${dto.calificacion}::int, ${c.texto}, ${c.feedback}, ${dto.mostrarComo ?? null}::mostrar_resena)`;
    return this.obtener(id);
  }

  async retirar(id: string) {
    await this.bd.tx().$executeRaw`SELECT retirar_resena(${id}::uuid)`;
    return this.obtener(id);
  }

  /** Las que escribio la cuenta (RLS: autor). */
  async mias() {
    const filas = await this.bd.tx().resena.findMany({ where: { autorId: this.bd.usuario().id }, orderBy: { creadaEn: 'desc' } });
    return filas.map((r) => ({ ...r, texto: texto(r.texto), feedbackPrivado: texto(r.feedbackPrivado) }));
  }

  private async obtener(id: string) {
    const r = await this.bd.tx().resena.findUnique({ where: { id } });
    if (!r) {
      throw new NotFoundException('Reseña no encontrada');
    }
    return { ...r, texto: texto(r.texto), feedbackPrivado: texto(r.feedbackPrivado) };
  }

  /** Cola de moderacion (ADMIN): sin el feedback privado; con los reportes publicos. */
  async paraModerar() {
    const filas = await this.bd.tx().$queryRaw<
      {
        id: string;
        profesional_id: string;
        calificacion: number;
        texto: Uint8Array | null;
        mostrar_como: MostrarResena;
        estado: EstadoResena;
        motivo_ocultamiento: string | null;
        creada_en: Date;
        editada_en: Date | null;
        reportes: { motivo: string; creado_en: string }[];
      }[]
    >`SELECT * FROM resenas_para_moderar()`;
    return filas.map((r) => ({ ...r, texto: this.llavero.descifrarCampo(r.texto, 'resenas', 'texto', r.id) }));
  }

  async moderar(id: string, publicar: boolean, motivo?: string) {
    await this.bd.tx().$executeRaw`SELECT moderar_resena(${id}::uuid, ${publicar}, ${motivo ?? null})`;
    return { id, estado: publicar ? 'PUBLICADA' : 'OCULTA' };
  }
}
