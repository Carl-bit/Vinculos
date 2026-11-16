import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsBoolean, IsOptional, Matches, ValidateIf } from 'class-validator';
import type { Request } from 'express';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { Interno, tokenInterno } from '../../core/interno/interno.guard';
import { type EstadoSalida, SoloLecturaGuard } from '../../core/salida/solo-lectura';

export class SalidaInternaDto {
  /** true: el silo pasa a solo lectura (S2); false: lo quita (reversion de la salida). */
  @IsBoolean()
  soloLectura!: boolean;

  /** Fecha de corte que el centro avisa a sus pacientes (YYYY-MM-DD). Obligatoria con soloLectura; prohibida sin ella. */
  @ValidateIf((d: SalidaInternaDto) => d.soloLectura)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  fechaCorte?: string;
}

/**
 * R12 (Vinculos Control, salida S2): solo lectura del silo. La regla vive en
 * salida_interna() (token del silo, sin contexto, idempotente, bitacora
 * eventos_salida); el guard SoloLecturaGuard la aplica a las rutas.
 */
@Controller('internal/salida')
@Interno()
export class SalidaInternaController {
  constructor(
    private readonly bd: ContextoBd,
    private readonly guard: SoloLecturaGuard,
  ) {}

  @Get()
  leer(): Promise<EstadoSalida> {
    this.guard.olvidar();
    return this.guard.estado();
  }

  @Post()
  @HttpCode(200)
  async aplicar(@Req() req: Request, @Body() dto: SalidaInternaDto): Promise<EstadoSalida & { resultado: 'APLICADA' | 'SIN_CAMBIOS' }> {
    const [f] = await this.bd.sinContexto('interno').$queryRaw<
      [{ resultado: 'APLICADA' | 'SIN_CAMBIOS'; solo_lectura: boolean; desde: Date | null; fecha_corte: string | null }]
    >`
      SELECT resultado, solo_lectura, desde, fecha_corte::text AS fecha_corte
      FROM salida_interna(${tokenInterno(req) ?? ''}, ${dto.soloLectura}, ${dto.soloLectura ? (dto.fechaCorte ?? null) : null}::date)`;
    this.guard.olvidar();
    return { resultado: f.resultado, soloLectura: f.solo_lectura, desde: f.desde, fechaCorte: f.fecha_corte };
  }
}
