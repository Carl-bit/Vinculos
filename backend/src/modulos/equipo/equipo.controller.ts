import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';

import { Roles } from '../../core/auth/decoradores';
import {
  AsignarTiposAtencionDto,
  CambiarSupervisorDto,
  ComentarioDto,
  DatosPrivadosDto,
  EditarPerfilDto,
  EditarTipoAtencionDto,
  MargenDto,
  PerfilDto,
  TarifaDto,
  TipoAtencionDto,
  TrayectoriaDto,
  VerificarTrayectoriaDto,
} from './dto/equipo.dto';
import { EquipoService } from './equipo.service';
import { SupervisionService } from './supervision.service';

const Uuid = new ParseUUIDPipe();
const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE'] as const;

/** Perfil, datos privados y tarifas: el propio escribe; ADMIN/GESTION leen (matriz_permisos.md). */
@Controller('profesionales')
export class PerfilesController {
  constructor(private readonly equipo: EquipoService) {}

  @Put('yo/perfil')
  @Roles('PROFESIONAL')
  guardarMiPerfil(@Body() dto: PerfilDto) {
    return this.equipo.guardarMiPerfil(dto);
  }

  @Get(':id/perfil')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  perfil(@Param('id', Uuid) id: string) {
    return this.equipo.perfil(id);
  }

  @Patch(':id/perfil')
  @Roles('ADMIN', 'GESTION')
  editarPerfil(@Param('id', Uuid) id: string, @Body() dto: EditarPerfilDto) {
    return this.equipo.editarPerfil(id, dto);
  }

  @Patch(':id/margen')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  margen(@Param('id', Uuid) id: string, @Body() dto: MargenDto) {
    return this.equipo.margen(id, dto.margenTrasladoMin);
  }

  @Get(':id/trayectoria')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  trayectoria(@Param('id', Uuid) id: string) {
    return this.equipo.trayectoria(id);
  }

  @Put('yo/datos-privados')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  guardarDatosPrivados(@Body() dto: DatosPrivadosDto) {
    return this.equipo.guardarMisDatosPrivados(dto);
  }

  @Get(':id/datos-privados')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  datosPrivados(@Param('id', Uuid) id: string) {
    return this.equipo.datosPrivados(id);
  }

  @Post('yo/tarifas')
  @Roles('PROFESIONAL')
  crearTarifa(@Body() dto: TarifaDto) {
    return this.equipo.crearTarifa(dto);
  }

  @Get(':id/tarifas')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  tarifas(@Param('id', Uuid) id: string) {
    return this.equipo.tarifas(id);
  }

  @Put(':id/tipos-atencion')
  @Roles('ADMIN')
  asignarTipos(@Param('id', Uuid) id: string, @Body() dto: AsignarTiposAtencionDto) {
    return this.equipo.asignarTiposAtencion(id, dto.tipoAtencionIds);
  }
}

@Controller('trayectoria')
export class TrayectoriaController {
  constructor(private readonly equipo: EquipoService) {}

  @Post()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  crear(@Body() dto: TrayectoriaDto) {
    return this.equipo.crearTrayectoria(dto);
  }

  @Put(':id')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  editar(@Param('id', Uuid) id: string, @Body() dto: TrayectoriaDto) {
    return this.equipo.editarTrayectoria(id, dto);
  }

  @Delete(':id')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  eliminar(@Param('id', Uuid) id: string) {
    return this.equipo.eliminarTrayectoria(id);
  }

  @Post(':id/verificacion')
  @Roles('ADMIN')
  verificar(@Param('id', Uuid) id: string, @Body() dto: VerificarTrayectoriaDto) {
    return this.equipo.verificarTrayectoria(id, dto.verificado);
  }
}

/** Catalogo (B): todos leen; ADMIN escribe; nunca DELETE (se desactiva). */
@Controller('tipos-atencion')
export class TiposAtencionController {
  constructor(private readonly equipo: EquipoService) {}

  @Get()
  @Roles(...TODOS)
  listar() {
    return this.equipo.tiposAtencion();
  }

  @Post()
  @Roles('ADMIN')
  crear(@Body() dto: TipoAtencionDto) {
    return this.equipo.crearTipoAtencion(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarTipoAtencionDto) {
    return this.equipo.editarTipoAtencion(id, dto);
  }
}

@Controller()
export class SupervisionController {
  constructor(private readonly supervision: SupervisionService) {}

  @Get('supervisiones')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  supervisiones() {
    return this.supervision.supervisiones();
  }

  /** Sin hueco: cierra y abre en la misma transaccion; avisa a los pacientes. */
  @Post('practicantes/:id/supervisor')
  @Roles('ADMIN')
  cambiarSupervisor(@Param('id', Uuid) id: string, @Body() dto: CambiarSupervisorDto) {
    return this.supervision.cambiarSupervisor(id, dto.supervisorId);
  }

  @Get('supervision/casos')
  @Roles('PROFESIONAL')
  casos() {
    return this.supervision.casos();
  }

  @Get('supervision/casos/:codigo/evoluciones')
  @Roles('PROFESIONAL')
  evoluciones(@Param('codigo') codigo: string) {
    return this.supervision.evoluciones(codigo);
  }

  @Post('supervision/evoluciones/:id/comentarios')
  @Roles('PROFESIONAL')
  comentar(@Param('id', Uuid) id: string, @Body() dto: ComentarioDto) {
    return this.supervision.comentar(id, dto.texto);
  }

  /** Los lee el tratante actual (incluido el practicante autor) y el supervisor vigente. */
  @Get('evoluciones/:id/comentarios')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  async comentarios(@Param('id', Uuid) id: string) {
    await this.supervision.exigirEvolucionVisible(id);
    return this.supervision.comentarios(id);
  }
}
