import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../core/docs/openapi';
import { Roles } from '../../core/auth/decoradores';
import { IMAGEN_MAX_BYTES } from '../../core/imagenes/imagenes';
import { CentroService } from './centro.service';
import {
  BajaRolDto,
  ContenidoPublicoDto,
  FiltroDirectorioDto,
  HorarioCentroDto,
  OtorgarRolDto,
  PoliticaDto,
  CambiarPasswordDto,
  CambiarSegundoFactorDto,
  CodigosRespaldo,
  EstadoSegundoFactor,
  CrearUsuarioDto,
  EditarConfiguracionDto,
  EditarMiCuentaDto,
  EditarUsuarioDto,
  IniciarBajaDto,
  MiCuenta,
  MiembroDirectorio,
  ModulosActivos,
  ReporteDashboard,
  OtorgarAccesoDto,
  RevocarAccesoDto,
  ConfiguracionCentroVista,
  ContenidoPublicoVista,
  HorarioCentroVista,
  LogoSubido,
  PoliticaVista,
  AccesoPracticanteOtorgado,
  AccesoPracticanteRevocado,
  AlertaAtendida,
  AlertaInternaVista,
  BajaIniciada,
  BajaRolResultado,
  BajaVista,
  HistorialAccesoPracticanteVista,
  InvitacionEquipo,
  PacientePorReasignar,
  PracticanteVista,
  TotpReiniciado,
  IntegranteEquipoTratante,
} from './dto/nucleo.dto';
import { EquipoAccesoService } from './equipo-acceso.service';
import { UsuariosService } from './usuarios.service';

const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE'] as const;
const EQUIPO = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'] as const;
const Uuid = new ParseUUIDPipe();

/** Roles segun docs/seguridad/matriz_permisos.md (usuarios, configuracion_centro). */
@ApiTags(TAGS.nucleo)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Post()
  @Roles('ADMIN')
  crear(@Body() dto: CrearUsuarioDto): Promise<MiCuenta> {
    return this.usuarios.crear(dto);
  }

  @Get()
  @Roles('ADMIN')
  listar(): Promise<MiCuenta[]> {
    return this.usuarios.listar();
  }

  @Get('yo')
  @Roles(...TODOS)
  yo(): Promise<MiCuenta> {
    return this.usuarios.miCuenta();
  }

  @Patch('yo')
  @Roles(...TODOS)
  editarYo(@Body() dto: EditarMiCuentaDto): Promise<MiCuenta> {
    return this.usuarios.editarMiCuenta(dto);
  }

  @Post('yo/password')
  @HttpCode(204)
  @Roles(...TODOS)
  cambiarPassword(@Body() dto: CambiarPasswordDto) {
    return this.usuarios.cambiarPassword(dto);
  }

  /** 03b-4.1: estado de la verificacion en dos pasos por correo. */
  @Get('yo/segundo-factor')
  @Roles(...TODOS)
  segundoFactor(): Promise<EstadoSegundoFactor> {
    return this.usuarios.segundoFactor();
  }

  /**
   * Activar o desactivar la verificacion por correo (pacientes y
   * responsables; el equipo no la desactiva: 422). Al activar devuelve los 10
   * codigos de respaldo.
   */
  @Put('yo/segundo-factor')
  @Roles(...TODOS)
  cambiarSegundoFactor(@Body() dto: CambiarSegundoFactorDto): Promise<CodigosRespaldo> {
    return this.usuarios.cambiarSegundoFactor(dto.activo);
  }

  /** Codigos de respaldo nuevos (anula los anteriores). 422 sin verificacion activa. */
  @Post('yo/segundo-factor/codigos-respaldo')
  @HttpCode(200)
  @Roles(...TODOS)
  codigosRespaldo(): Promise<CodigosRespaldo> {
    return this.usuarios.nuevosCodigosRespaldo();
  }

  @Get(':id')
  @Roles('ADMIN')
  obtener(@Param('id', Uuid) id: string): Promise<MiCuenta> {
    return this.usuarios.obtener(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarUsuarioDto): Promise<MiCuenta> {
    return this.usuarios.editar(id, dto);
  }

  /** Reenvia la invitacion de una cuenta de equipo (enlace de un solo uso para fijar la contraseña). */
  @Post(':id/invitacion')
  @Roles('ADMIN')
  invitar(@Param('id', Uuid) id: string): Promise<InvitacionEquipo> {
    return this.usuarios.invitar(id);
  }

  /** C-1: segundo rol (PROFESIONAL) de una cuenta ADMIN o GESTION. */
  @Post(':id/roles')
  @Roles('ADMIN')
  otorgarRol(@Param('id', Uuid) id: string, @Body() dto: OtorgarRolDto): Promise<MiCuenta> {
    return this.usuarios.otorgarRol(id, dto.rol);
  }

  /** Baja de un rol adicional (no de la cuenta). */
  @Post(':id/roles/PROFESIONAL/baja')
  @Roles('ADMIN')
  bajaRol(@Param('id', Uuid) id: string, @Body() dto: BajaRolDto): Promise<BajaRolResultado> {
    return this.usuarios.bajaRol(id, 'PROFESIONAL', dto.fechaEfectiva);
  }

  @Post(':id/totp/reinicio')
  @HttpCode(200)
  @Roles('ADMIN')
  reiniciarTotp(@Param('id', Uuid) id: string): Promise<TotpReiniciado> {
    return this.usuarios.reiniciarTotp(id);
  }
}

@ApiTags(TAGS.nucleo)
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @Roles(...TODOS)
  obtener(): Promise<ConfiguracionCentroVista> {
    return this.usuarios.obtenerConfiguracion();
  }

  @Patch()
  @Roles('ADMIN')
  editar(@Body() dto: EditarConfiguracionDto): Promise<ConfiguracionCentroVista> {
    return this.usuarios.editarConfiguracion(dto);
  }
}

/** Datos del centro (03a): contenido publico, logo, politicas, horario, modulos y dashboard. */
@ApiTags(TAGS.nucleo)
@Controller()
export class CentroController {
  constructor(private readonly centro: CentroService) {}

  /** Modulos contratados: el front oculta los inactivos; la API responde 403 en sus rutas. */
  @Get('modulos')
  @Roles(...TODOS)
  modulos(): Promise<ModulosActivos> {
    return this.centro.modulos();
  }

  @Get('configuracion/contenido-publico')
  @Roles(...EQUIPO)
  contenido(): Promise<ContenidoPublicoVista> {
    return this.centro.contenido();
  }

  @Patch('configuracion/contenido-publico')
  @Roles('ADMIN')
  editarContenido(@Body() dto: ContenidoPublicoDto): Promise<ContenidoPublicoVista> {
    return this.centro.editarContenido(dto);
  }

  @Post('configuracion/logo')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('imagen', { limits: { fileSize: IMAGEN_MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['imagen'], properties: { imagen: { type: 'string', format: 'binary', description: 'JPEG, PNG o WebP' } } } })
  subirLogo(@UploadedFile() imagen?: Express.Multer.File): Promise<LogoSubido> {
    if (!imagen) {
      throw new BadRequestException('Falta la imagen (campo "imagen", multipart/form-data)');
    }
    return this.centro.subirLogo(imagen.buffer);
  }

  /** Todas las versiones (la vigente de cada tipo es la de mayor version). */
  @Get('politicas')
  @Roles(...EQUIPO)
  politicas(): Promise<PoliticaVista[]> {
    return this.centro.politicas();
  }

  @Post('politicas')
  @Roles('ADMIN')
  publicarPolitica(@Body() dto: PoliticaDto): Promise<PoliticaVista> {
    return this.centro.publicarPolitica(dto.tipo, dto.texto);
  }

  @Get('configuracion/horario')
  @Roles(...EQUIPO)
  horario(): Promise<HorarioCentroVista[]> {
    return this.centro.horario();
  }

  @Put('configuracion/horario')
  @Roles('ADMIN')
  reemplazarHorario(@Body() dto: HorarioCentroDto): Promise<HorarioCentroVista[]> {
    return this.centro.reemplazarHorario(dto.bloques);
  }

  /** ADMIN/GESTION: agregados del centro (sin datos clinicos). PROFESIONAL/PRACTICANTE: los suyos. */
  @Get('reportes/dashboard')
  @Roles(...EQUIPO)
  dashboard(): Promise<ReporteDashboard> {
    return this.centro.dashboard() as Promise<ReporteDashboard>;
  }
}

@ApiTags(TAGS.nucleo)
@Controller('practicantes')
export class PracticantesController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  /** ADMIN/GESTION todos; el practicante el propio; el supervisor los suyos (RLS). */
  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  listar(): Promise<PracticanteVista[]> {
    return this.equipo.practicantes();
  }

  @Post(':id/acceso')
  @Roles('ADMIN')
  otorgar(@Param('id', Uuid) id: string, @Body() dto: OtorgarAccesoDto): Promise<AccesoPracticanteOtorgado> {
    return this.equipo.otorgarAcceso(id, dto);
  }

  @Post(':id/revocacion')
  @Roles('ADMIN')
  revocar(@Param('id', Uuid) id: string, @Body() dto: RevocarAccesoDto): Promise<AccesoPracticanteRevocado> {
    return this.equipo.revocarAcceso(id, dto.motivo);
  }

  @Get(':id/historial')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  historial(@Param('id', Uuid) id: string): Promise<HistorialAccesoPracticanteVista[]> {
    return this.equipo.historialAccesos(id);
  }
}

@ApiTags(TAGS.nucleo)
@Controller('bajas')
export class BajasController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  /** ADMIN (otro ADMIN, nunca la propia, nunca el ultimo: lo impone la BD). */
  @Post()
  @Roles('ADMIN')
  iniciar(@Body() dto: IniciarBajaDto): Promise<BajaIniciada> {
    return this.equipo.iniciarBaja(dto);
  }

  @Get()
  @Roles('ADMIN', 'GESTION')
  listar(): Promise<BajaVista[]> {
    return this.equipo.bajas();
  }

  /** Bandeja: ADMIN/GESTION con nombre; supervisor (PROFESIONAL) seudonimizada. */
  @Get('por-reasignar')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  porReasignar(): Promise<PacientePorReasignar[]> {
    return this.equipo.pacientesPorReasignar();
  }
}

@ApiTags(TAGS.nucleo)
@Controller('alertas')
export class AlertasController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  @Get()
  @Roles('ADMIN')
  listar(): Promise<AlertaInternaVista[]> {
    return this.equipo.alertas();
  }

  @Post(':id/atendida')
  @HttpCode(200)
  @Roles('ADMIN')
  atender(@Param('id', Uuid) id: string): Promise<AlertaAtendida> {
    return this.equipo.atenderAlerta(id);
  }
}

@ApiTags(TAGS.nucleo)
@Controller('directorio')
export class DirectorioController {
  constructor(private readonly equipo: EquipoAccesoService) {}

  /** Contacto solo ADMIN/GESTION; PRACTICANTE solo ve a su supervisor (la funcion lo filtra). */
  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  equipoInterno(@Query() filtro: FiltroDirectorioDto): Promise<MiembroDirectorio[]> {
    return this.equipo.directorio(filtro);
  }

  @Get('mi-equipo')
  @Roles('PACIENTE', 'RESPONSABLE')
  miEquipo(): Promise<IntegranteEquipoTratante[]> {
    return this.equipo.miEquipoTratante();
  }
}
