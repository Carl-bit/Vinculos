import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { Interno, tokenInterno } from '../../core/interno/interno.guard';

export interface ExportacionInterna {
  id: string;
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'LISTA' | 'FALLIDA' | 'DESCARGADA' | 'VENCIDA';
  creadaEn: Date;
  terminadaEn: Date | null;
  venceEn: Date | null;
  bytes: number | null;
  huella: string | null;
}

/**
 * R13 (Vinculos Control): estado de las exportaciones del centro, sin
 * contenido, sin clave ni quien la pidio. La regla vive en
 * exportaciones_internas() (token del silo, sin contexto de usuario).
 */
@Controller('internal/exportaciones')
@Interno()
export class ExportacionesInternasController {
  constructor(private readonly bd: ContextoBd) {}

  @Get()
  async listar(@Req() req: Request): Promise<{ exportaciones: ExportacionInterna[] }> {
    const filas = await this.bd.sinContexto('interno').$queryRaw<
      {
        id: string;
        estado: ExportacionInterna['estado'];
        creada_en: Date;
        terminada_en: Date | null;
        vence_en: Date | null;
        bytes: bigint | null;
        huella: string | null;
      }[]
    >`SELECT id, estado::text AS estado, creada_en, terminada_en, vence_en, bytes, huella FROM exportaciones_internas(${tokenInterno(req) ?? ''})`;
    return {
      exportaciones: filas.map((f) => ({
        id: f.id,
        estado: f.estado,
        creadaEn: f.creada_en,
        terminadaEn: f.terminada_en,
        venceEn: f.vence_en,
        bytes: f.bytes === null ? null : Number(f.bytes),
        huella: f.huella,
      })),
    };
  }
}
