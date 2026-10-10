import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { EstadoTipoSesion } from '@prisma/client';

import { Roles } from '../../core/auth/decoradores';
import { CatalogosRetencionService } from './catalogos-retencion.service';
import {
  BuscarPacientesDto,
  CatalogoDto,
  CrearAdultoResponsableDto,
  CrearEvolucionDto,
  CrearPacienteDto,
  EditarPacienteDto,
  ProponerTipoSesionDto,
  RevisarTipoSesionDto,
  RevisionRetencionDto,
} from './dto/fichas.dto';
import { EvolucionesService } from './evoluciones.service';
import { PacientesService } from './pacientes.service';

const Uuid = new ParseUUIDPipe();
const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE'] as const;

/** Roles segun matriz_permisos.md (pacientes, adultos_responsables, fichas_clinicas). */
@Controller('pacientes')
export class PacientesController {
  constructor(private readonly pacientes: PacientesService) {}

  @Post()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  crear(@Body() dto: CrearPacienteDto) {
    return this.pacientes.crear(dto);
  }

  @Get()
  @Roles(...TODOS)
  listar(@Query() filtro: BuscarPacientesDto) {
    return this.pacientes.listar(filtro.rut);
  }

  @Get(':id')
  @Roles(...TODOS)
  obtener(@Param('id', Uuid) id: string) {
    return this.pacientes.obtener(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarPacienteDto) {
    return this.pacientes.editar(id, dto);
  }

  @Post(':id/adultos-responsables')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  crearAdulto(@Param('id', Uuid) id: string, @Body() dto: CrearAdultoResponsableDto) {
    return this.pacientes.crearAdultoResponsable(id, dto);
  }

  @Get(':id/adultos-responsables')
  @Roles(...TODOS)
  adultos(@Param('id', Uuid) id: string) {
    return this.pacientes.adultosResponsables(id);
  }

  /** Metadata: ADMIN y el tratante. GESTION y PACIENTE nunca (clinico). */
  @Get(':id/ficha')
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  ficha(@Param('id', Uuid) id: string) {
    return this.pacientes.ficha(id);
  }

  @Post(':id/ficha')
  @Roles('ADMIN', 'PROFESIONAL')
  abrirFicha(@Param('id', Uuid) id: string) {
    return this.pacientes.abrirFicha(id);
  }
}

/** Evoluciones: solo el tratante. ADMIN, GESTION, PACIENTE y supervisor nunca (supervision: 02e). */
@Controller('fichas/:fichaId/evoluciones')
export class EvolucionesController {
  constructor(private readonly evoluciones: EvolucionesService) {}

  @Post()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  crear(@Param('fichaId', Uuid) fichaId: string, @Body() dto: CrearEvolucionDto) {
    return this.evoluciones.crear(fichaId, dto);
  }

  @Get()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  listar(@Param('fichaId', Uuid) fichaId: string) {
    return this.evoluciones.listar(fichaId);
  }
}

@Controller()
export class CatalogosClinicosController {
  constructor(private readonly catalogos: CatalogosRetencionService) {}

  @Get('tipos-sesion')
  @Roles(...TODOS)
  tiposSesion(@Query('estado', new ParseEnumPipe(EstadoTipoSesion, { optional: true })) estado?: EstadoTipoSesion) {
    return this.catalogos.tiposSesion(estado);
  }

  @Post('tipos-sesion')
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  proponer(@Body() dto: ProponerTipoSesionDto) {
    return this.catalogos.proponerTipoSesion(dto);
  }

  @Patch('tipos-sesion/:id')
  @Roles('ADMIN')
  revisar(@Param('id', Uuid) id: string, @Body() dto: RevisarTipoSesionDto) {
    return this.catalogos.revisarTipoSesion(id, dto);
  }

  @Get('intervenciones')
  @Roles(...TODOS)
  intervenciones() {
    return this.catalogos.intervenciones();
  }

  @Post('intervenciones')
  @Roles('ADMIN')
  crearIntervencion(@Body() dto: CatalogoDto) {
    return this.catalogos.crearIntervencion(dto);
  }

  @Get('estados-avance')
  @Roles(...TODOS)
  estadosAvance() {
    return this.catalogos.estadosAvance();
  }

  @Post('estados-avance')
  @Roles('ADMIN')
  crearEstadoAvance(@Body() dto: CatalogoDto) {
    return this.catalogos.crearEstadoAvance(dto);
  }
}

/** Revision anual de retencion: solo ADMIN. */
@Controller('retencion')
export class RetencionController {
  constructor(private readonly catalogos: CatalogosRetencionService) {}

  @Get('fichas')
  @Roles('ADMIN')
  fichas() {
    return this.catalogos.fichasSobreRetencion();
  }

  @Post('revisiones')
  @Roles('ADMIN')
  revisar(@Body() dto: RevisionRetencionDto) {
    return this.catalogos.revisarRetencion(dto);
  }

  @Get('revisiones')
  @Roles('ADMIN')
  revisiones() {
    return this.catalogos.revisionesRetencion();
  }
}
