import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

import { Actor, Roles } from '../auth/decoradores';
import { ContextoBd, encontrado, type UsuarioActual } from '../bd/contexto-bd.service';

const Uuid = new ParseUUIDPipe();
const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Personalizacion de una plantilla (ADMIN). Las variables las valida la BD (variable no permitida: 23514 -> 422). */
export class EditarPlantillaDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @Length(1, 200)
  asunto?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @Length(1, 4000)
  cuerpo?: string;

  /** BANDEJA no se desactiva (CHECK -> 422). */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

/** Solo lo desactivable: los avisos legales no tienen campo (un campo extra es 400). */
export class PreferenciasDto {
  @IsOptional()
  @IsBoolean()
  recordatorios?: boolean;

  @IsOptional()
  @IsBoolean()
  avisosOperativos?: boolean;
}

const PREFERENCIAS = { recordatorios: true, avisosOperativos: true } as const;

/**
 * Mensajeria (02i). Registro (metadatos): ADMIN/GESTION todos; cada
 * destinatario los suyos (RLS). Bandeja (registro oficial, con contenido):
 * solo los propios. Preferencias: el paciente.
 */
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly bd: ContextoBd) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
  listar() {
    // Sin creadaPorId: un candidato de derivacion no debe saber quien rechazo antes (02h).
    return this.bd.tx().notificacion.findMany({
      select: {
        id: true,
        tipo: true,
        canal: true,
        pacienteId: true,
        usuarioId: true,
        referenciaId: true,
        estado: true,
        intentos: true,
        proximoIntento: true,
        creadaEn: true,
        procesadaEn: true,
      },
      orderBy: { creadaEn: 'desc' },
      take: 200,
    });
  }

  /** Bandeja propia: mensajes ya armados (el job los arma en menos de un minuto). */
  @Get('bandeja')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
  async bandeja(@Actor() actor: UsuarioActual) {
    const propio = actor.rol === 'PACIENTE' ? { pacienteId: await this.pacienteActual() } : { usuarioId: actor.id };
    return this.bd.tx().notificacion.findMany({
      where: { ...propio, canal: 'BANDEJA', estado: 'ENVIADO' },
      select: { id: true, tipo: true, referenciaId: true, asunto: true, cuerpo: true, creadaEn: true },
      orderBy: { creadaEn: 'desc' },
      take: 200,
    });
  }

  @Get('preferencias')
  @Roles('PACIENTE')
  async preferencias() {
    return (await this.bd.tx().preferenciaNotificacion.findFirst({ select: PREFERENCIAS })) ?? { recordatorios: true, avisosOperativos: true };
  }

  @Put('preferencias')
  @Roles('PACIENTE')
  async guardarPreferencias(@Body() dto: PreferenciasDto) {
    const pacienteId = await this.pacienteActual();
    return this.bd.tx().preferenciaNotificacion.upsert({
      where: { pacienteId },
      create: { pacienteId, ...dto },
      update: dto,
      select: PREFERENCIAS,
    });
  }

  private async pacienteActual(): Promise<string> {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`SELECT app_paciente_id() AS id`;
    return id;
  }
}

/** Plantillas de mensaje (B): solo ADMIN. Sin crear ni borrar: se personalizan o se restaura el ejemplo. */
@Controller('plantillas-mensaje')
export class PlantillasMensajeController {
  constructor(private readonly bd: ContextoBd) {}

  @Get()
  @Roles('ADMIN')
  listar() {
    return this.bd.tx().plantillaMensaje.findMany({ orderBy: [{ evento: 'asc' }, { destinatario: 'asc' }, { canal: 'asc' }] });
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarPlantillaDto) {
    return this.bd.tx().plantillaMensaje.update({ where: { id }, data: dto });
  }

  @Post(':id/restauracion')
  @HttpCode(200)
  @Roles('ADMIN')
  async restaurar(@Param('id', Uuid) id: string) {
    const p = encontrado(await this.bd.tx().plantillaMensaje.findUnique({ where: { id } }), 'Plantilla');
    return this.bd.tx().plantillaMensaje.update({ where: { id }, data: { asunto: p.asuntoEjemplo, cuerpo: p.cuerpoEjemplo, activa: true } });
  }
}
