import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { EstadoTipoSesion } from '@prisma/client';

import { ErrorCuerpoGrande, TAGS } from '../../core/docs/openapi';
import { Roles } from '../../core/auth/decoradores';
import { AdjuntosService } from './adjuntos.service';
import { CatalogosRetencionService } from './catalogos-retencion.service';
import { DocumentosService } from './documentos.service';
import {
  AccesoTemporalDto,
  AltaDto,
  BorradorDto,
  BuscarPacientesDto,
  ConfirmarBorradorDto,
  ConsentimientoAtencionDto,
  CrearIngresoDto,
  EditarPlantillaClinicaDto,
  ListarPlantillasDto,
  ProponerPlantillaDto,
  ResolverDuplicadoDto,
  InvitarPacienteDto,
  ListarBorradoresDto,
  AceptacionRegistrada,
  AceptacionVista,
  AdultoResponsableVista,
  CatalogoDto,
  CrearAdultoResponsableDto,
  CrearEvolucionDto,
  CrearPacienteDto,
  DocumentoClinicoVista,
  EditarPacienteDto,
  EditarTipoDocumentoDto,
  EmitirDocumentoDto,
  EnlaceEnviado,
  EnviarDocumentoDto,
  EstadoFichaPaciente,
  EvolucionVista,
  FichaVista,
  InvitacionEnviada,
  PacienteCreado,
  PacienteVista,
  RespuestasMatchPaciente,
  ProponerTipoSesionDto,
  RevisarTipoSesionDto,
  RevisionRetencionDto,
  TipoDocumentoDto,
  AccesoTemporalVista,
} from './dto/fichas.dto';
import { EvolucionesService } from './evoluciones.service';
import { IngresosService } from './ingresos.service';
import { PacientesService } from './pacientes.service';
import { PlantillasService } from './plantillas.service';
import { SeguimientoService } from './seguimiento.service';
import { Modulo } from '../../core/modulos/modulos';

const Uuid = new ParseUUIDPipe();

/** Respuesta binaria descargable (sin cache: datos clinicos). */
const archivo = (contenido: Buffer, tipo: string, nombre: string) =>
  new StreamableFile(contenido, { type: tipo, disposition: `attachment; filename="${encodeURIComponent(nombre)}"` });
const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE'] as const;

/** Roles segun matriz_permisos.md (pacientes, adultos_responsables, fichas_clinicas). */
@ApiTags(TAGS.fichas)
@Controller('pacientes')
@Modulo('FICHAS')
export class PacientesController {
  constructor(
    private readonly pacientes: PacientesService,
    private readonly seguimiento: SeguimientoService,
  ) {}

  @Post()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  crear(@Body() dto: CrearPacienteDto): Promise<PacienteCreado> {
    return this.pacientes.crear(dto);
  }

  @Get()
  @Roles(...TODOS)
  listar(@Query() filtro: BuscarPacientesDto): Promise<PacienteVista[]> {
    return this.pacientes.listar(filtro);
  }

  @Get(':id')
  @Roles(...TODOS)
  obtener(@Param('id', Uuid) id: string): Promise<PacienteVista> {
    return this.pacientes.obtener(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarPacienteDto): Promise<PacienteVista> {
    return this.pacientes.editar(id, dto);
  }

  @Post(':id/adultos-responsables')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  crearAdulto(@Param('id', Uuid) id: string, @Body() dto: CrearAdultoResponsableDto): Promise<AdultoResponsableVista> {
    return this.pacientes.crearAdultoResponsable(id, dto);
  }

  @Get(':id/adultos-responsables')
  @Roles(...TODOS)
  adultos(@Param('id', Uuid) id: string): Promise<AdultoResponsableVista[]> {
    return this.pacientes.adultosResponsables(id);
  }

  /** Metadata: ADMIN y el tratante. GESTION y PACIENTE nunca (clinico). */
  @Get(':id/ficha')
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  ficha(@Param('id', Uuid) id: string): Promise<FichaVista> {
    return this.pacientes.ficha(id);
  }

  @Post(':id/ficha')
  @Roles('ADMIN', 'PROFESIONAL')
  abrirFicha(@Param('id', Uuid) id: string): Promise<FichaVista> {
    return this.pacientes.abrirFicha(id);
  }

  /** Invitacion de cuenta: el paciente (desde 14 años) o su adulto responsable si es menor. */
  @Post(':id/invitacion')
  @Roles('ADMIN', 'GESTION')
  invitar(@Param('id', Uuid) id: string, @Body() dto: InvitarPacienteDto): Promise<InvitacionEnviada> {
    return this.pacientes.invitar(id, dto);
  }

  /**
   * Posible duplicado (D-2: nunca se fusiona por nombre): solo administracion
   * lo resuelve (DISTINTO o MISMO_PACIENTE), atiende la alerta y queda auditado.
   */
  @Post(':id/duplicado-revisado')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  duplicadoRevisado(@Param('id', Uuid) id: string, @Body() dto: ResolverDuplicadoDto): Promise<PacienteVista> {
    return this.pacientes.duplicadoRevisado(id, dto.resolucion);
  }

  /** Politicas y consentimientos aceptados (version, canal, otorgante). */
  @Get(':id/aceptaciones')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
  aceptaciones(@Param('id', Uuid) id: string): Promise<AceptacionVista[]> {
    return this.pacientes.aceptaciones(id);
  }

  /** Consentimiento informado de atencion firmado en el centro (respaldo obligatorio). */
  @Post(':id/consentimiento-atencion')
  @Roles('ADMIN', 'GESTION')
  consentimientoAtencion(@Param('id', Uuid) id: string, @Body() dto: ConsentimientoAtencionDto): Promise<AceptacionRegistrada> {
    return this.pacientes.consentimientoAtencion(id, dto.respaldoRef, dto.adultoResponsableId);
  }

  /** Enlace de un solo uso por correo para el consentimiento de atencion. */
  @Post(':id/consentimiento-atencion/enlace')
  @Roles('ADMIN', 'GESTION')
  enlaceConsentimiento(@Param('id', Uuid) id: string): Promise<EnlaceEnviado> {
    return this.pacientes.enlaceConsentimientoAtencion(id);
  }

  /** Alta: el tratante, con fecha y motivo (cifrado). La ficha se conserva. */
  @Post(':id/alta')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  alta(@Param('id', Uuid) id: string, @Body() dto: AltaDto) {
    return this.seguimiento.registrarAlta(id, dto.fecha, dto.motivo);
  }

  @Get(':id/altas')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  altas(@Param('id', Uuid) id: string) {
    return this.seguimiento.altas(id);
  }

  /** Lo que el paciente respondio en el match al pedir hora (solo el tratante; ADMIN/GESTION nunca). */
  @Get(':id/respuestas-match')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  respuestasMatch(@Param('id', Uuid) id: string): Promise<RespuestasMatchPaciente[]> {
    return this.seguimiento.respuestasMatch(id);
  }

  /** Acceso clinico temporal (reemplazo o interconsulta): ADMIN o el tratante. */
  @Post(':id/accesos-temporales')
  @Roles('ADMIN', 'PROFESIONAL')
  otorgarAcceso(@Param('id', Uuid) id: string, @Body() dto: AccesoTemporalDto): Promise<AccesoTemporalVista> {
    return this.seguimiento.otorgarAccesoTemporal(id, dto);
  }

  @Get(':id/accesos-temporales')
  @Roles('ADMIN', 'PROFESIONAL')
  accesosTemporales(@Param('id', Uuid) id: string): Promise<AccesoTemporalVista[]> {
    return this.seguimiento.accesosTemporales(id);
  }
}

/** Seguimiento clinico (03a): borradores, accesos temporales recibidos y estado de fichas. */
@ApiTags(TAGS.fichas)
@Controller()
@Modulo('FICHAS')
export class SeguimientoController {
  constructor(private readonly seguimiento: SeguimientoService) {}

  /** Borradores propios (solo su autor los ve). */
  @Get('borradores')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  borradores(@Query() filtro: ListarBorradoresDto) {
    return this.seguimiento.borradores(filtro.fichaId);
  }

  @Post('fichas/:fichaId/borradores')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  crearBorrador(@Param('fichaId', Uuid) fichaId: string, @Body() dto: BorradorDto) {
    return this.seguimiento.crearBorrador(fichaId, dto);
  }

  /** Guardado automatico. */
  @Put('borradores/:id')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  guardarBorrador(@Param('id', Uuid) id: string, @Body() dto: BorradorDto) {
    return this.seguimiento.guardarBorrador(id, dto);
  }

  @Delete('borradores/:id')
  @HttpCode(204)
  @Roles('PROFESIONAL', 'PRACTICANTE')
  descartarBorrador(@Param('id', Uuid) id: string) {
    return this.seguimiento.descartarBorrador(id);
  }

  /** Pasa a evolucion (append-only) y el borrador se elimina. */
  @Post('borradores/:id/confirmacion')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  confirmarBorrador(@Param('id', Uuid) id: string, @Body() dto: ConfirmarBorradorDto) {
    return this.seguimiento.confirmarBorrador(id, dto);
  }

  /** ADMIN: todos; PROFESIONAL: recibidos y de sus pacientes. */
  @Get('accesos-temporales')
  @Roles('ADMIN', 'PROFESIONAL')
  accesosTemporales(): Promise<AccesoTemporalVista[]> {
    return this.seguimiento.accesosTemporales();
  }

  /** Vista administrativa: ultima/proxima sesion y sesiones sin cerrar por paciente (sin contenido clinico). */
  @Get('profesionales/:id/estado-fichas')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  estadoFichas(@Param('id', Uuid) id: string): Promise<EstadoFichaPaciente[]> {
    return this.seguimiento.estadoFichas(id);
  }
}

/** Evoluciones: solo el tratante. ADMIN, GESTION, PACIENTE y supervisor nunca (supervision: 02e). */
@ApiTags(TAGS.fichas)
@Controller('fichas/:fichaId/evoluciones')
@Modulo('FICHAS')
export class EvolucionesController {
  constructor(private readonly evoluciones: EvolucionesService) {}

  @Post()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  crear(@Param('fichaId', Uuid) fichaId: string, @Body() dto: CrearEvolucionDto) {
    return this.evoluciones.crear(fichaId, dto);
  }

  @Get()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  listar(@Param('fichaId', Uuid) fichaId: string): Promise<EvolucionVista[]> {
    return this.evoluciones.listar(fichaId);
  }
}

@ApiTags(TAGS.fichas)
@Controller()
@Modulo('FICHAS')
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
@ApiTags(TAGS.fichas)
@Controller('retencion')
@Modulo('FICHAS')
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

/** Catalogo (B) de tipos de documento clinico: el equipo lee; ADMIN escribe; nunca DELETE. */
@ApiTags(TAGS.fichas)
@Controller('tipos-documento-clinico')
@Modulo('FICHAS')
export class TiposDocumentoController {
  constructor(private readonly documentos: DocumentosService) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  listar() {
    return this.documentos.tipos();
  }

  @Post()
  @Roles('ADMIN')
  crear(@Body() dto: TipoDocumentoDto) {
    return this.documentos.crearTipo(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarTipoDocumentoDto) {
    return this.documentos.editarTipo(id, dto);
  }
}

/**
 * Documentos clinicos (02h): emite y envia el tratante; el paciente los ve,
 * pide el adjunto y descarga por el enlace del correo (con sesion).
 * ADMIN/GESTION nunca ven el contenido; ADMIN audita los envios.
 */
@ApiTags(TAGS.fichas)
@Controller('documentos-clinicos')
@Modulo('FICHAS')
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  @Post()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  @ErrorCuerpoGrande()
  emitir(@Body() dto: EmitirDocumentoDto) {
    return this.documentos.emitir(dto);
  }

  @Get()
  @Roles('PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
  listar(@Query('pacienteId', new ParseUUIDPipe({ optional: true })) pacienteId?: string): Promise<DocumentoClinicoVista[]> {
    return this.documentos.listar(pacienteId);
  }

  /** Destino del enlace del correo: exige sesion del paciente; registra la descarga. PDF generado al entregar. */
  @Get('descarga/:token')
  @Roles('PACIENTE', 'RESPONSABLE')
  async descargar(@Param('token') token: string) {
    const { nombreArchivo, pdf } = await this.documentos.descargar(token);
    return archivo(pdf, 'application/pdf', nombreArchivo);
  }

  /** Antes de 03b-4: descarga desde el portal con sesion (queda registrada como la del enlace). */
  @Get(':id/pdf')
  @Roles('PACIENTE', 'RESPONSABLE')
  async descargarPortal(@Param('id', Uuid) id: string) {
    const { nombreArchivo, pdf } = await this.documentos.descargarPortal(id);
    return archivo(pdf, 'application/pdf', nombreArchivo);
  }

  @Post(':id/envios')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  enviar(@Param('id', Uuid) id: string, @Body() dto: EnviarDocumentoDto) {
    return this.documentos.enviar(id, dto.modo);
  }

  @Get(':id/envios')
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  envios(@Param('id', Uuid) id: string) {
    return this.documentos.envios(id);
  }

  @Post(':id/solicitud-adjunto')
  @HttpCode(200)
  @Roles('PACIENTE', 'RESPONSABLE')
  solicitarAdjunto(@Param('id', Uuid) id: string): Promise<DocumentoClinicoVista> {
    return this.documentos.solicitarAdjunto(id);
  }
}

/**
 * Adjuntos externos de la ficha (02i): informes o imagenes de terceros que
 * sube el tratante. Multipart (campo "archivo", limite ADJUNTO_MAX_MB, mas ->
 * 413); tipo validado por contenido (PDF, PNG, JPEG; si no -> 422). Misma RLS
 * y auditoria que la ficha: ADMIN, GESTION y el paciente no los ven.
 */
@ApiTags(TAGS.fichas)
@Controller()
@Modulo('FICHAS')
export class AdjuntosFichaController {
  constructor(private readonly adjuntos: AdjuntosService) {}

  @Post('pacientes/:id/adjuntos')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  @UseInterceptors(FileInterceptor('archivo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: { type: 'string', format: 'binary', description: 'PDF, PNG o JPEG' } } } })
  @ErrorCuerpoGrande()
  subir(@Param('id', Uuid) pacienteId: string, @UploadedFile() archivo?: Express.Multer.File) {
    if (!archivo) {
      throw new BadRequestException('Falta el archivo (campo "archivo", multipart/form-data)');
    }
    return this.adjuntos.subir(pacienteId, archivo);
  }

  @Get('pacientes/:id/adjuntos')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  listar(@Param('id', Uuid) pacienteId: string) {
    return this.adjuntos.listar(pacienteId);
  }

  @Get('adjuntos-ficha/:id')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  async descargar(@Param('id', Uuid) id: string) {
    const a = await this.adjuntos.descargar(id);
    return archivo(a.contenido, a.tipoMime, a.nombreArchivo);
  }
}

/**
 * Plantillas clinicas por especialidad (03a-2). Leen ADMIN y el equipo
 * clinico (borradores: ADMIN y su autor); proponen ADMIN y PROFESIONAL con la
 * especialidad aprobada; solo ADMIN publica y desactiva.
 */
@ApiTags(TAGS.fichas)
@Controller('plantillas-clinicas')
@Modulo('FICHAS')
export class PlantillasClinicasController {
  constructor(private readonly plantillas: PlantillasService) {}

  @Get()
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  listar(@Query() filtro: ListarPlantillasDto) {
    return this.plantillas.listar(filtro);
  }

  @Get(':id')
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  obtener(@Param('id', Uuid) id: string) {
    return this.plantillas.obtener(id);
  }

  @Post()
  @Roles('ADMIN', 'PROFESIONAL')
  proponer(@Body() dto: ProponerPlantillaDto) {
    return this.plantillas.proponer(dto);
  }

  /** Solo un borrador (una version publicada es inmutable: 409). */
  @Patch(':id')
  @Roles('ADMIN', 'PROFESIONAL')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarPlantillaClinicaDto) {
    return this.plantillas.editar(id, dto);
  }

  /** Editar una plantilla = version nueva en borrador (copia de la indicada). */
  @Post(':id/versiones')
  @Roles('ADMIN', 'PROFESIONAL')
  nuevaVersion(@Param('id', Uuid) id: string) {
    return this.plantillas.nuevaVersion(id);
  }

  /** La version publicada anterior de la familia queda INACTIVA. */
  @Post(':id/publicacion')
  @HttpCode(200)
  @Roles('ADMIN')
  publicar(@Param('id', Uuid) id: string) {
    return this.plantillas.publicar(id);
  }

  @Post(':id/desactivacion')
  @HttpCode(200)
  @Roles('ADMIN')
  desactivar(@Param('id', Uuid) id: string) {
    return this.plantillas.desactivar(id);
  }
}

/** Ficha de ingreso / anamnesis (03a-2, append-only): solo el equipo tratante. */
@ApiTags(TAGS.fichas)
@Controller('fichas/:fichaId/ingresos')
@Modulo('FICHAS')
export class IngresosController {
  constructor(private readonly ingresos: IngresosService) {}

  @Post()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  crear(@Param('fichaId', Uuid) fichaId: string, @Body() dto: CrearIngresoDto) {
    return this.ingresos.crear(fichaId, dto);
  }

  @Get()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  listar(@Param('fichaId', Uuid) fichaId: string) {
    return this.ingresos.listar(fichaId);
  }
}
