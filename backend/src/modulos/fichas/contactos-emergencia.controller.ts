import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Roles } from '../../core/auth/decoradores';
import { TAGS } from '../../core/docs/openapi';
import { ContactosEmergenciaService } from './contactos-emergencia.service';
import {
  ContactoEmergenciaDto,
  ContactoEmergenciaResumen,
  ContactoEmergenciaVista,
  EmergenciaContactoDto,
  PacienteContactosDto,
  RetornoAtencionTemporal,
} from './dto/contactos-emergencia.dto';

const Uuid = new ParseUUIDPipe();
const PORTAL = ['PACIENTE', 'RESPONSABLE'] as const;
const TRATANTE = ['PROFESIONAL', 'PRACTICANTE'] as const;

/**
 * Punto 38: contactos de emergencia. El portal los administra; el tratante ve
 * existencia y parentesco, abre los datos solo en emergencia (auditado) y pide
 * al paciente que agregue uno. ADMIN y GESTION no tienen ruta (punto 20).
 */
@ApiTags(TAGS.fichas)
@Controller()
export class ContactosEmergenciaController {
  constructor(private readonly contactos: ContactosEmergenciaService) {}

  @Get('portal/contactos-emergencia')
  @Roles(...PORTAL)
  mios(@Query() filtro: PacienteContactosDto): Promise<ContactoEmergenciaVista[]> {
    return this.contactos.mios(filtro.pacienteId);
  }

  @Post('portal/contactos-emergencia')
  @Roles(...PORTAL)
  crear(@Body() dto: ContactoEmergenciaDto): Promise<ContactoEmergenciaVista[]> {
    return this.contactos.crear(dto);
  }

  @Patch('portal/contactos-emergencia/:id')
  @Roles(...PORTAL)
  editar(@Param('id', Uuid) id: string, @Body() dto: ContactoEmergenciaDto): Promise<ContactoEmergenciaVista[]> {
    return this.contactos.editar(id, dto);
  }

  @Delete('portal/contactos-emergencia/:id')
  @HttpCode(204)
  @Roles(...PORTAL)
  eliminar(@Param('id', Uuid) id: string): Promise<void> {
    return this.contactos.eliminar(id);
  }

  /** Punto 9: al agendar, si el paciente esta en atencion temporal y su principal ya esta disponible (RLS: ADMIN, tratante, principal). */
  @Get('pacientes/:id/retorno')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  retorno(@Param('id', Uuid) id: string): Promise<RetornoAtencionTemporal | null> {
    return this.contactos.retorno(id);
  }

  @Get('pacientes/:id/contactos-emergencia')
  @Roles(...TRATANTE)
  resumen(@Param('id', Uuid) id: string): Promise<ContactoEmergenciaResumen[]> {
    return this.contactos.resumen(id);
  }

  @Post('pacientes/:id/contactos-emergencia/emergencia')
  @HttpCode(200)
  @Roles(...TRATANTE)
  emergencia(@Param('id', Uuid) id: string, @Body() dto: EmergenciaContactoDto): Promise<ContactoEmergenciaVista[]> {
    return this.contactos.emergencia(id, dto.motivo);
  }

  @Post('pacientes/:id/contactos-emergencia/aviso')
  @HttpCode(204)
  @Roles(...TRATANTE)
  pedir(@Param('id', Uuid) id: string): Promise<void> {
    return this.contactos.pedir(id);
  }
}
