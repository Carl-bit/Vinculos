import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import { Roles } from '../../core/auth/decoradores';
import {
  CambiarPasswordDto,
  CrearUsuarioDto,
  EditarConfiguracionDto,
  EditarMiCuentaDto,
  EditarUsuarioDto,
  IniciarBajaDto,
  OtorgarAccesoDto,
  RevocarAccesoDto,
} from './dto/nucleo.dto';
import { EquipoAccesoService } from './equipo-acceso.service';
import { UsuariosService } from './usuarios.service';

const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE'] as const;
const Uuid = new ParseUUIDPipe();

/** Roles segun docs/seguridad/matriz_permisos.md (usuarios, configuracion_centro). */
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Post()
  @Roles('ADMIN')
  crear(@Body() dto: CrearUsuarioDto) {
    return this.usuarios.crear(dto);
  }

  @Get()
  @Roles('ADMIN')
  listar() {
    return this.usuarios.listar();
  }

  @Get('yo')
  @Roles(...TODOS)
  yo() {
    return this.usuarios.miCuenta();
  }

  @Patch('yo')
  @Roles(...TODOS)
  editarYo(@Body() dto: EditarMiCuentaDto) {
    return this.usuarios.editarMiCuenta(dto);
  }

  @Post('yo/password')
  @HttpCode(204)
  @Roles(...TODOS)
  cambiarPassword(@Body() dto: CambiarPasswordDto) {
    return this.usuarios.cambiarPassword(dto);
  }

  @Get(':id')
  @Roles('ADMIN')
  obtener(@Param('id', Uuid) id: string) {
    return this.usuarios.obtener(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarUsuarioDto) {
    return this.usuarios.editar(id, dto);
  }
}

@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @Roles(...TODOS)
  obtener() {
    return this.usuarios.obtenerConfiguracion();
  }

  @Patch()
  @Roles('ADMIN')
  editar(@Body() dto: EditarConfiguracionDto) {
    return this.usuarios.editarConfiguracion(dto);
  }
}

@Controller('practicantes')
export class PracticantesController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  /** ADMIN/GESTION todos; el practicante el propio; el supervisor los suyos (RLS). */
  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  listar() {
    return this.equipo.practicantes();
  }

  @Post(':id/acceso')
  @Roles('ADMIN')
  otorgar(@Param('id', Uuid) id: string, @Body() dto: OtorgarAccesoDto) {
    return this.equipo.otorgarAcceso(id, dto);
  }

  @Post(':id/revocacion')
  @Roles('ADMIN')
  revocar(@Param('id', Uuid) id: string, @Body() dto: RevocarAccesoDto) {
    return this.equipo.revocarAcceso(id, dto.motivo);
  }

  @Get(':id/historial')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  historial(@Param('id', Uuid) id: string) {
    return this.equipo.historialAccesos(id);
  }
}

@Controller('bajas')
export class BajasController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  /** ADMIN (otro ADMIN, nunca la propia, nunca el ultimo: lo impone la BD). */
  @Post()
  @Roles('ADMIN')
  iniciar(@Body() dto: IniciarBajaDto) {
    return this.equipo.iniciarBaja(dto);
  }

  @Get()
  @Roles('ADMIN', 'GESTION')
  listar() {
    return this.equipo.bajas();
  }

  /** Bandeja: ADMIN/GESTION con nombre; supervisor (PROFESIONAL) seudonimizada. */
  @Get('por-reasignar')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  porReasignar() {
    return this.equipo.pacientesPorReasignar();
  }
}

@Controller('alertas')
export class AlertasController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  @Get()
  @Roles('ADMIN')
  listar() {
    return this.equipo.alertas();
  }

  @Post(':id/atendida')
  @HttpCode(200)
  @Roles('ADMIN')
  atender(@Param('id', Uuid) id: string) {
    return this.equipo.atenderAlerta(id);
  }
}

@Controller('directorio')
export class DirectorioController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  /** Contacto solo ADMIN/GESTION; PRACTICANTE solo ve a su supervisor (la funcion lo filtra). */
  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  equipoInterno() {
    return this.equipo.directorio();
  }

  @Get('mi-equipo')
  @Roles('PACIENTE')
  miEquipo() {
    return this.equipo.miEquipoTratante();
  }
}
