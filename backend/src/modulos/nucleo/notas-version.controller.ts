import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';

import { Roles } from '../../core/auth/decoradores';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { TAGS } from '../../core/docs/openapi';
import { Interno, tokenInterno } from '../../core/interno/interno.guard';

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;

export class NotasVersionInternaDto {
  @Matches(VERSION)
  version!: string;

  /** Texto plano que escribe el operador de Vinculos (sin datos personales). */
  @IsString()
  @MaxLength(4000)
  notas!: string;
}

/** R6: notas de una version de la plataforma para el ADMIN. */
export class NotaVersionVista {
  @ApiProperty()
  version!: string;
  @ApiProperty()
  notas!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  recibidaEn!: Date;
}

/**
 * R6 (Vinculos Control, U6 de ACTUALIZAR): el agente entrega las notas de la
 * version al silo. La regla vive en registrar_notas_version() (token del silo,
 * sin contexto, idempotente).
 */
@Controller('internal/notas-version')
@Interno()
export class NotasVersionInternaController {
  constructor(private readonly bd: ContextoBd) {}

  @Post()
  @HttpCode(200)
  async registrar(@Req() req: Request, @Body() dto: NotasVersionInternaDto): Promise<{ resultado: 'REGISTRADA' | 'SIN_CAMBIOS' }> {
    const [{ resultado }] = await this.bd.sinContexto('interno').$queryRaw<[{ resultado: 'REGISTRADA' | 'SIN_CAMBIOS' }]>`
      SELECT registrar_notas_version(${tokenInterno(req) ?? ''}, ${dto.version}, ${dto.notas}) AS resultado`;
    return { resultado };
  }
}

/** R6: novedades de la plataforma para el ADMIN (Configuracion > Vinculos). La RLS deja leer solo a ADMIN. */
@ApiTags(TAGS.nucleo)
@Controller('configuracion/notas-version')
export class NotasVersionController {
  constructor(private readonly bd: ContextoBd) {}

  @Get()
  @Roles('ADMIN')
  async listar(): Promise<NotaVersionVista[]> {
    const filas = await this.bd.tx().notaVersion.findMany({ orderBy: { recibidaEn: 'desc' }, take: 20 });
    return filas.map((f) => ({ version: f.version, notas: f.notas, recibidaEn: f.recibidaEn }));
  }
}
