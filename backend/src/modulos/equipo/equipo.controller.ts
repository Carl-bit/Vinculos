import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../core/docs/openapi';
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
  ProponerTipoAtencionDto,
  RevisarTipoAtencionDto,
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
@ApiTags(TAGS.equipo)
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

  /** El propio propone; ADMIN aprueba o rechaza (solo los aprobados cuentan). */
  @Post('yo/tipos-atencion')
  @Roles('PROFESIONAL')
  proponerTipo(@Body() dto: ProponerTipoAtencionDto) {
    return this.equipo.proponerTipoAtencion(dto.tipoAtencionId);
  }

  @Get(':id/tipos-atencion')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  tiposDe(@Param('id', Uuid) id: string) {
    return this.equipo.tiposDe(id);
  }

  @Patch(':id/tipos-atencion/:tipoAtencionId')
  @Roles('ADMIN')
  revisarTipo(@Param('id', Uuid) id: string, @Param('tipoAtencionId', Uuid) tipoId: string, @Body() dto: RevisarTipoAtencionDto) {
    return this.equipo.revisarTipoAtencion(id, tipoId, dto.estado);
  }

  @Put(':id/tipos-atencion')
  @Roles('ADMIN')
  asignarTipos(@Param('id', Uuid) id: string, @Body() dto: AsignarTiposAtencionDto) {
    return this.equipo.asignarTiposAtencion(id, dto.tipoAtencionIds);
  }
}

@ApiTags(TAGS.equipo)
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
@ApiTags(TAGS.equipo)
@Controller('tipos-atencion')
export class TiposAtencionController {
  constructor(private readonly equipo: EquipoService) {}

  @Get()
  @Roles(...TODOS)
  listar() {
    return this.equipo.tiposAtencion();
  }

  /** Cola de propuestas de profesionales (PROPUESTO). */
  @Get('propuestas')
  @Roles('ADMIN')
  propuestas() {
    return this.equipo.propuestasTiposAtencion();
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

@ApiTags(TAGS.equipo)
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
