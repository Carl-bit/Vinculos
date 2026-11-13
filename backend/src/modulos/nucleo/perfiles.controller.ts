import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Roles } from '../../core/auth/decoradores';
import { TAGS } from '../../core/docs/openapi';
import { AsignarPerfilDto, EditarPerfilRolDto, PerfilRolDto, PerfilRolVista } from './dto/perfiles.dto';
import { PerfilesService } from './perfiles.service';

const Uuid = new ParseUUIDPipe();

@ApiTags(TAGS.nucleo)
@Controller('perfiles')
export class PerfilesController {
  constructor(private readonly perfiles: PerfilesService) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  listar(): Promise<PerfilRolVista[]> {
    return this.perfiles.listar();
  }

  @Post()
  @Roles('ADMIN')
  crear(@Body() dto: PerfilRolDto): Promise<PerfilRolVista> {
    return this.perfiles.crear(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarPerfilRolDto): Promise<PerfilRolVista> {
    return this.perfiles.editar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('ADMIN')
  eliminar(@Param('id', Uuid) id: string): Promise<void> {
    return this.perfiles.eliminar(id);
  }

  @Post(':id/asignaciones')
  @Roles('ADMIN')
  asignar(@Param('id', Uuid) id: string, @Body() dto: AsignarPerfilDto): Promise<PerfilRolVista> {
    return this.perfiles.asignar(id, dto.usuarioId);
  }

  @Delete(':id/asignaciones/:usuarioId')
  @Roles('ADMIN')
  quitar(@Param('id', Uuid) id: string, @Param('usuarioId', Uuid) usuarioId: string): Promise<PerfilRolVista> {
    return this.perfiles.quitar(id, usuarioId);
  }
}
