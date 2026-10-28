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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { RespuestaArchivo, TAGS } from '../../core/docs/openapi';
import { Publico, Roles } from '../../core/auth/decoradores';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
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
  LecturaProtocoloVista,
  ProtocoloEquipoVista,
  ProtocoloLeido,
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
  FiltroAuditoriaDto,
  RegistroAuditoria,
  AutorizacionSoporteVista,
  OtorgarSoporteDto,
  RegistroSoporteVista,
  AceptarContratoDto,
  ContratoCentroVista,
  AvanzarSolicitudDerechoDto,
  RegistrarSolicitudDerechoDto,
  SolicitudDerechoVista,
  BloquearTratamientoDto,
  CancelarPerifericosDto,
  CancelacionPerifericos,
  EstadoBloqueoVista,
  SolicitudDerechoPublicaDto,
  SolicitudDerechoPublicaRecibida,
  DescargaExportacionDto,
  ExportacionPacienteVista,
  ExportarCentroDto,
} from './dto/nucleo.dto';
import { ExportacionesService } from './exportaciones.service';
import { DerechosService } from './derechos.service';
import { AuditoriaService } from './auditoria.service';
import { SoporteService } from './soporte.service';
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

  /** AUD-01 (E2.2): contrato del centro con Vinculos (terminos y DPA) y sus aceptaciones. */
  @Get('contrato-centro')
  @Roles('ADMIN')
  contrato(): Promise<ContratoCentroVista> {
    return this.centro.contrato();
  }

  @Post('contrato-centro/aceptacion')
  @HttpCode(200)
  @Roles('ADMIN')
  aceptarContrato(@Body() dto: AceptarContratoDto): Promise<ContratoCentroVista> {
    return this.centro.aceptarContrato(dto.tipo);
  }

  /** 03b-4.2: protocolo interno del centro (version vigente) y si la cuenta ya lo leyo. */
  @Get('protocolo')
  @Roles(...EQUIPO)
  protocolo(): Promise<ProtocoloEquipoVista> {
    return this.centro.protocoloEquipo();
  }

  @Post('protocolo/lectura')
  @Roles(...EQUIPO)
  marcarProtocoloLeido(): Promise<ProtocoloLeido> {
    return this.centro.marcarProtocoloLeido();
  }

  /** Registro para la direccion: quien leyo la version vigente. */
  @Get('protocolo/lecturas')
  @Roles('ADMIN', 'GESTION')
  lecturasProtocolo(): Promise<LecturaProtocoloVista[]> {
    return this.centro.lecturasProtocolo();
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

/** AUD-01 (E1.5): quien vio, escribio, descargo o exporto, con su rol activo. Solo ADMIN (RLS). */
@ApiTags(TAGS.nucleo)
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get('accesos')
  @Roles('ADMIN')
  accesos(@Query() filtro: FiltroAuditoriaDto): Promise<RegistroAuditoria[]> {
    return this.auditoria.registros(filtro);
  }
}

/**
 * AUD-01 (E2.1): el centro autoriza (plazo y alcance) al soporte de Vinculos,
 * que nunca ve datos personales ni clinicos, y ve cada diagnostico ejecutado.
 */
@ApiTags(TAGS.nucleo)
@Controller('soporte')
export class SoporteController {
  constructor(private readonly soporte: SoporteService) {}

  @Get('autorizaciones')
  @Roles('ADMIN')
  autorizaciones(): Promise<AutorizacionSoporteVista[]> {
    return this.soporte.autorizaciones();
  }

  @Post('autorizaciones')
  @Roles('ADMIN')
  otorgar(@Body() dto: OtorgarSoporteDto): Promise<AutorizacionSoporteVista> {
    return this.soporte.otorgar(dto);
  }

  @Post('autorizaciones/:id/revocacion')
  @HttpCode(200)
  @Roles('ADMIN')
  revocar(@Param('id', Uuid) id: string): Promise<AutorizacionSoporteVista> {
    return this.soporte.revocar(id);
  }

  @Get('registro')
  @Roles('ADMIN')
  registro(): Promise<RegistroSoporteVista[]> {
    return this.soporte.registro();
  }
}

/** AUD-01 (E2.3a): solicitudes de derechos de los titulares, con plazo en dias habiles. Solo ADMIN. */
@ApiTags(TAGS.nucleo)
@Controller('derechos')
export class DerechosController {
  constructor(private readonly derechos: DerechosService) {}

  @Get('solicitudes')
  @Roles('ADMIN')
  solicitudes(): Promise<SolicitudDerechoVista[]> {
    return this.derechos.solicitudes();
  }

  @Post('solicitudes')
  @Roles('ADMIN')
  registrar(@Body() dto: RegistrarSolicitudDerechoDto): Promise<SolicitudDerechoVista> {
    return this.derechos.registrar(dto);
  }

  @Post('solicitudes/:id/estado')
  @HttpCode(200)
  @Roles('ADMIN')
  avanzar(@Param('id', Uuid) id: string, @Body() dto: AvanzarSolicitudDerechoDto): Promise<SolicitudDerechoVista> {
    return this.derechos.avanzar(id, dto);
  }

  /** AUD-01 (E2.3c): bloqueo visible; impide gestiones nuevas (citas, derivaciones, edicion de datos). */
  @Post('pacientes/:id/bloqueo')
  @HttpCode(200)
  @Roles('ADMIN')
  bloquear(@Param('id', Uuid) id: string, @Body() dto: BloquearTratamientoDto): Promise<EstadoBloqueoVista> {
    return this.derechos.bloquear(id, dto);
  }

  @Post('pacientes/:id/bloqueo/levantamiento')
  @HttpCode(200)
  @Roles('ADMIN')
  levantar(@Param('id', Uuid) id: string): Promise<EstadoBloqueoVista> {
    return this.derechos.levantar(id);
  }

  /** Cancelacion: borra lo periferico y conserva la ficha (responde el motivo legal). */
  @Post('pacientes/:id/cancelacion')
  @HttpCode(200)
  @Roles('ADMIN')
  cancelar(@Param('id', Uuid) id: string, @Body() dto: CancelarPerifericosDto): Promise<CancelacionPerifericos> {
    return this.derechos.cancelarPerifericos(id, dto.solicitudId);
  }
}

/** AUD-01 (E2.3b): formulario publico de derechos por RUT; misma respuesta exista o no (rate limit publico). */
@ApiTags(TAGS.nucleo)
@Controller('publico/derechos')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class DerechosPublicoController {
  constructor(private readonly derechos: DerechosService) {}

  @Post()
  @HttpCode(202)
  solicitar(@Body() dto: SolicitudDerechoPublicaDto): Promise<SolicitudDerechoPublicaRecibida> {
    return this.derechos.solicitudPublica(dto);
  }
}

/** Respuesta binaria descargable (sin cache: datos personales). */
const archivo = (contenido: Buffer, tipo: string, nombre: string) =>
  new StreamableFile(contenido, { type: tipo, disposition: `attachment; filename="${encodeURIComponent(nombre)}"` });

/**
 * AUD-01 Fase 3: exportaciones. Paciente: ADMIN prepara desde la solicitud,
 * el tratante agrega la parte clinica, el paciente descarga (sesion o
 * codigo). Centro: ADMIN, cifrada con su clave.
 */
@ApiTags(TAGS.nucleo)
@Controller()
export class ExportacionesController {
  constructor(private readonly exportaciones: ExportacionesService) {}

  @Post('derechos/solicitudes/:id/exportacion')
  @Roles('ADMIN')
  preparar(@Param('id', Uuid) id: string): Promise<ExportacionPacienteVista> {
    return this.exportaciones.preparar(id);
  }

  @Get('exportaciones/pendientes')
  @Roles('PROFESIONAL')
  pendientes(): Promise<ExportacionPacienteVista[]> {
    return this.exportaciones.pendientesClinicas();
  }

  @Post('exportaciones/:id/clinica')
  @HttpCode(200)
  @Roles('PROFESIONAL')
  clinica(@Param('id', Uuid) id: string): Promise<ExportacionPacienteVista> {
    return this.exportaciones.agregarClinica(id);
  }

  /** Paciente con cuenta: descarga con su sesion. */
  @Post('portal/exportacion/descarga')
  @HttpCode(200)
  @Roles('PACIENTE')
  @RespuestaArchivo('application/json', 'application/pdf')
  async descargarPortal(@Body() dto: DescargaExportacionDto) {
    const a = await this.exportaciones.descargar(dto.token, null, dto.formato, true);
    return archivo(a.contenido, a.tipo, a.nombre);
  }

  /** Exportacion completa del centro, cifrada con la clave del ADMIN (no se guarda). */
  @Post('exportacion-centro')
  @HttpCode(200)
  @Roles('ADMIN')
  @RespuestaArchivo('application/octet-stream')
  async centro(@Body() dto: ExportarCentroDto) {
    const a = await this.exportaciones.exportarCentro(dto.clave);
    return archivo(a.contenido, 'application/octet-stream', a.nombre);
  }
}

/** Paciente sin cuenta: descarga con el codigo del segundo correo (rate limit publico). */
@ApiTags(TAGS.nucleo)
@Controller('publico/exportacion')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class ExportacionPublicaController {
  constructor(private readonly exportaciones: ExportacionesService) {}

  @Post('descarga')
  @HttpCode(200)
  @RespuestaArchivo('application/json', 'application/pdf')
  async descargar(@Body() dto: DescargaExportacionDto) {
    const a = await this.exportaciones.descargar(dto.token, dto.codigo ?? '', dto.formato, false);
    return archivo(a.contenido, a.tipo, a.nombre);
  }
}
