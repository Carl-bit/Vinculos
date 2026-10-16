import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { TAGS } from '../docs/openapi';
import { Actor, Roles } from '../auth/decoradores';
import { ContextoBd, encontrado, type UsuarioActual } from '../bd/contexto-bd.service';
import { EditarPlantillaDto, PreferenciasDto } from './notificaciones.dto';

const Uuid = new ParseUUIDPipe();
const PREFERENCIAS = { recordatorios: true, avisosOperativos: true } as const;

/**
 * Mensajeria (02i). Registro (metadatos): ADMIN/GESTION todos; cada
 * destinatario los suyos (RLS). Bandeja (registro oficial, con contenido):
 * solo los propios. Preferencias: el paciente.
 */
@ApiTags(TAGS.mensajeria)
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly bd: ContextoBd) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
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
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
  async bandeja(@Actor() actor: UsuarioActual) {
    // RESPONSABLE (03a): los suyos y los de sus menores a cargo (la RLS los filtra).
    const propio = actor.rol === 'PACIENTE' ? { pacienteId: await this.pacienteActual() } : actor.rol === 'RESPONSABLE' ? {} : { usuarioId: actor.id };
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

  /** 03a-2: el adulto responsable elige los avisos de cada menor a su cargo (le llegan a el). */
  @Get('preferencias/pacientes/:pacienteId')
  @Roles('RESPONSABLE')
  async preferenciasDe(@Param('pacienteId', Uuid) pacienteId: string) {
    await this.exigirACargo(pacienteId);
    return (
      (await this.bd.tx().preferenciaNotificacion.findUnique({ where: { pacienteId }, select: PREFERENCIAS })) ?? {
        recordatorios: true,
        avisosOperativos: true,
      }
    );
  }

  @Put('preferencias/pacientes/:pacienteId')
  @Roles('RESPONSABLE')
  async guardarPreferenciasDe(@Param('pacienteId', Uuid) pacienteId: string, @Body() dto: PreferenciasDto) {
    await this.exigirACargo(pacienteId);
    return this.bd.tx().preferenciaNotificacion.upsert({ where: { pacienteId }, create: { pacienteId, ...dto }, update: dto, select: PREFERENCIAS });
  }

  /** 404 si el menor no esta a cargo de esta cuenta (no revela que existe). */
  private async exigirACargo(pacienteId: string) {
    const [{ ok }] = await this.bd.tx().$queryRaw<[{ ok: boolean }]>`
      SELECT ${pacienteId}::uuid IN (SELECT pacientes_a_cargo()) AS ok`;
    encontrado(ok || null, 'Paciente');
  }

  private async pacienteActual(): Promise<string> {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`SELECT app_paciente_id() AS id`;
    return id;
  }
}

/** Plantillas de mensaje (B): solo ADMIN. Sin crear ni borrar: se personalizan o se restaura el ejemplo. */
@ApiTags(TAGS.mensajeria)
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
