import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
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

import { ErrorCuerpoGrande, RespuestaArchivo, TAGS } from '../../core/docs/openapi';
import { Actor, Roles } from '../../core/auth/decoradores';
import { Modulo } from '../../core/modulos/modulos';
import type { UsuarioActual } from '../../core/bd/contexto-bd.service';
import { IMAGEN_MAX_BYTES } from '../../core/imagenes/imagenes';
import {
  AsignarTiposAtencionDto,
  CambiarSupervisorDto,
  ComentarioDto,
  CorregirCampoDto,
  DatosPrivadosDto,
  DocumentoPracticanteDto,
  ObservarTrayectoriaDto,
  PedirCorreccionDto,
  InformarRegistroSisDto,
  VerificacionManualSisDto,
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
import {
  CorreccionPerfilVista,
  DatosPrivadosVista,
  DocumentoPracticanteVista,
  FotoSubida,
  MiResenaRecibida,
  PerfilProfesionalVista,
  RegistroSisVista,
  SolicitudCorreccion,
  SupervisionVista,
  CasoSupervision,
  ComentarioSupervision,
  EvolucionSupervisada,
  SupervisorCambiado,
  TarifaVista,
  TipoAtencionProfesionalVista,
  TipoAtencionVista,
  TrayectoriaEliminada,
  TrayectoriaVista,
} from './dto/equipo-respuestas.dto';
import { EquipoService } from './equipo.service';
import { RegistroSisService } from './registro-sis.service';
import { SupervisionService } from './supervision.service';

const Uuid = new ParseUUIDPipe();

function exigirImagen(imagen?: Express.Multer.File): Buffer {
  if (!imagen) {
    throw new BadRequestException('Falta la imagen (campo "imagen", multipart/form-data)');
  }
  return imagen.buffer;
}
const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE'] as const;

/** Perfil, datos privados y tarifas: el propio escribe; ADMIN/GESTION leen (matriz_permisos.md). */
@ApiTags(TAGS.equipo)
@Controller('profesionales')
@Modulo('EQUIPO')
export class PerfilesController {
  constructor(
    private readonly equipo: EquipoService,
    private readonly registroSis: RegistroSisService,
  ) {}

  /** 03b-4.2: el profesional informa (o quita) su registro en la Superintendencia; se intenta verificar en el acto. */
  @Put('yo/registro-sis')
  @Roles('PROFESIONAL')
  informarRegistroSis(@Body() dto: InformarRegistroSisDto): Promise<RegistroSisVista> {
    return this.registroSis.informar(dto.numero);
  }

  /** 03b-4.2: registro en la Superintendencia (los practicantes no tienen: los supervisa un profesional). */
  @Get(':id/registro-sis')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  registroSisDe(@Param('id', Uuid) id: string): Promise<RegistroSisVista> {
    return this.registroSis.ver(id);
  }

  @Post(':id/registro-sis/verificacion')
  @Roles('ADMIN')
  verificarRegistroSis(@Param('id', Uuid) id: string): Promise<RegistroSisVista> {
    return this.registroSis.verificar(id);
  }

  @Post(':id/registro-sis/verificacion-manual')
  @Roles('ADMIN')
  verificarRegistroSisManual(@Param('id', Uuid) id: string, @Body() dto: VerificacionManualSisDto): Promise<RegistroSisVista> {
    return this.registroSis.verificarManual(id, dto);
  }

  @Put('yo/perfil')
  @Roles('PROFESIONAL')
  guardarMiPerfil(@Body() dto: PerfilDto): Promise<PerfilProfesionalVista> {
    return this.equipo.guardarMiPerfil(dto);
  }

  /** Foto de perfil propia (JPEG, PNG o WebP; se publica sin metadatos). */
  @Post('yo/foto')
  @Roles('PROFESIONAL')
  @UseInterceptors(FileInterceptor('imagen', { limits: { fileSize: IMAGEN_MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['imagen'], properties: { imagen: { type: 'string', format: 'binary' } } } })
  subirMiFoto(@Actor() actor: UsuarioActual, @UploadedFile() imagen?: Express.Multer.File): Promise<FotoSubida> {
    return this.equipo.subirFoto(actor.id, exigirImagen(imagen));
  }

  /** Reseñas recibidas con su estado y el feedback privado (solo el propio). */
  @Get('yo/resenas')
  @Roles('PROFESIONAL')
  misResenas(): Promise<MiResenaRecibida[]> {
    return this.equipo.misResenas();
  }

  @Get(':id/perfil')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  perfil(@Param('id', Uuid) id: string): Promise<PerfilProfesionalVista> {
    return this.equipo.perfil(id);
  }

  @Patch(':id/perfil')
  @Roles('ADMIN', 'GESTION')
  editarPerfil(@Param('id', Uuid) id: string, @Body() dto: EditarPerfilDto): Promise<PerfilProfesionalVista> {
    return this.equipo.editarPerfil(id, dto);
  }

  /** Pedidos y correcciones del perfil publico (2026-11-08): ADMIN/GESTION todos; el profesional los suyos. */
  @Get(':id/correcciones')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  correcciones(@Param('id', Uuid) id: string): Promise<CorreccionPerfilVista[]> {
    return this.equipo.correcciones(id);
  }

  /** La cuenta madre pide corregir campos del perfil publico (no lo modifica). */
  @Post(':id/correcciones')
  @Roles('ADMIN')
  pedirCorreccion(@Param('id', Uuid) id: string, @Body() dto: PedirCorreccionDto): Promise<SolicitudCorreccion[]> {
    return this.equipo.pedirCorreccion(id, dto);
  }

  /** A la segunda solicitud del mismo campo sin cambios, la cuenta madre lo corrige (422 si no corresponde). */
  @Post(':id/correcciones/aplicacion')
  @Roles('ADMIN')
  corregirCampo(@Param('id', Uuid) id: string, @Body() dto: CorregirCampoDto): Promise<PerfilProfesionalVista> {
    return this.equipo.corregirCampo(id, dto);
  }

  @Patch(':id/margen')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  margen(@Param('id', Uuid) id: string, @Body() dto: MargenDto): Promise<PerfilProfesionalVista> {
    return this.equipo.margen(id, dto.margenTrasladoMin);
  }

  @Get(':id/trayectoria')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  trayectoria(@Param('id', Uuid) id: string): Promise<TrayectoriaVista[]> {
    return this.equipo.trayectoria(id);
  }

  @Put('yo/datos-privados')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  guardarDatosPrivados(@Body() dto: DatosPrivadosDto): Promise<DatosPrivadosVista> {
    return this.equipo.guardarMisDatosPrivados(dto);
  }

  @Get(':id/datos-privados')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  datosPrivados(@Param('id', Uuid) id: string): Promise<DatosPrivadosVista> {
    return this.equipo.datosPrivados(id);
  }

  @Post('yo/tarifas')
  @Roles('PROFESIONAL')
  crearTarifa(@Body() dto: TarifaDto): Promise<TarifaVista> {
    return this.equipo.crearTarifa(dto);
  }

  @Get(':id/tarifas')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  tarifas(@Param('id', Uuid) id: string): Promise<TarifaVista[]> {
    return this.equipo.tarifas(id);
  }

  /** El propio propone; ADMIN aprueba o rechaza (solo los aprobados cuentan). */
  @Post('yo/tipos-atencion')
  @Roles('PROFESIONAL')
  proponerTipo(@Body() dto: ProponerTipoAtencionDto): Promise<TipoAtencionProfesionalVista[]> {
    return this.equipo.proponerTipoAtencion(dto.tipoAtencionId);
  }

  @Get(':id/tipos-atencion')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  tiposDe(@Param('id', Uuid) id: string): Promise<TipoAtencionProfesionalVista[]> {
    return this.equipo.tiposDe(id);
  }

  @Patch(':id/tipos-atencion/:tipoAtencionId')
  @Roles('ADMIN')
  revisarTipo(
    @Param('id', Uuid) id: string,
    @Param('tipoAtencionId', Uuid) tipoId: string,
    @Body() dto: RevisarTipoAtencionDto,
  ): Promise<TipoAtencionProfesionalVista> {
    return this.equipo.revisarTipoAtencion(id, tipoId, dto.estado);
  }

  @Put(':id/tipos-atencion')
  @Roles('ADMIN')
  asignarTipos(@Param('id', Uuid) id: string, @Body() dto: AsignarTiposAtencionDto): Promise<TipoAtencionProfesionalVista[]> {
    return this.equipo.asignarTiposAtencion(id, dto.tipoAtencionIds);
  }
}

@ApiTags(TAGS.equipo)
@Controller('trayectoria')
@Modulo('EQUIPO')
export class TrayectoriaController {
  constructor(private readonly equipo: EquipoService) {}

  @Post()
  @Roles('PROFESIONAL', 'PRACTICANTE')
  crear(@Body() dto: TrayectoriaDto): Promise<TrayectoriaVista> {
    return this.equipo.crearTrayectoria(dto);
  }

  @Put(':id')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  editar(@Param('id', Uuid) id: string, @Body() dto: TrayectoriaDto): Promise<TrayectoriaVista> {
    return this.equipo.editarTrayectoria(id, dto);
  }

  @Delete(':id')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  eliminar(@Param('id', Uuid) id: string): Promise<TrayectoriaEliminada> {
    return this.equipo.eliminarTrayectoria(id);
  }

  /** Verificar exige un respaldo cargado (422 sin el). */
  @Post(':id/verificacion')
  @Roles('ADMIN')
  verificar(@Param('id', Uuid) id: string, @Body() dto: VerificarTrayectoriaDto): Promise<TrayectoriaVista> {
    return this.equipo.verificarTrayectoria(id, dto.verificado);
  }

  /** Observacion de la cuenta madre sobre el respaldo: el titulo vuelve a revision (2026-11-08). */
  @Post(':id/observacion')
  @Roles('ADMIN')
  observar(@Param('id', Uuid) id: string, @Body() dto: ObservarTrayectoriaDto): Promise<TrayectoriaVista> {
    return this.equipo.observarTrayectoria(id, dto.observacion);
  }

  /**
   * Respaldo del titulo (2026-11-07): PDF, PNG o JPEG por contenido (422),
   * hasta ADJUNTO_MAX_MB (413). Version nueva; el titulo vuelve a revision.
   */
  @Post(':id/respaldos')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  @UseInterceptors(FileInterceptor('archivo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: { type: 'string', format: 'binary', description: 'PDF, PNG o JPEG' } } } })
  @ErrorCuerpoGrande()
  subirRespaldo(@Param('id', Uuid) id: string, @UploadedFile() archivo?: Express.Multer.File): Promise<TrayectoriaVista> {
    if (!archivo) {
      throw new BadRequestException('Falta el archivo (campo "archivo", multipart/form-data)');
    }
    return this.equipo.subirRespaldo(id, archivo);
  }

  /** Descarga del respaldo: el propio y ADMIN/GESTION; queda en registro_exportaciones. */
  @Get('respaldos/:id')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  @RespuestaArchivo('application/pdf', 'image/png', 'image/jpeg')
  async descargarRespaldo(@Param('id', Uuid) id: string) {
    const r = await this.equipo.descargarRespaldo(id);
    return new StreamableFile(r.contenido, { type: r.tipoMime, disposition: `attachment; filename="${encodeURIComponent(r.nombreArchivo)}"` });
  }
}

/**
 * Documentos del practicante (2026-11-08): certificado de alumno regular y
 * convenio de practica. Versionados y cifrados; no habilitan ni cortan el
 * acceso. Suben el propio y ADMIN; leen el propio, ADMIN y GESTION.
 */
@ApiTags(TAGS.equipo)
@Controller('practicantes')
@Modulo('EQUIPO')
export class DocumentosPracticanteController {
  constructor(private readonly equipo: EquipoService) {}

  @Get(':id/documentos')
  @Roles('ADMIN', 'GESTION', 'PRACTICANTE')
  listar(@Param('id', Uuid) id: string): Promise<DocumentoPracticanteVista[]> {
    return this.equipo.documentosPracticante(id);
  }

  /** PDF, PNG o JPEG por contenido (422), hasta ADJUNTO_MAX_MB (413). Tipo y vigencia en la query. */
  @Post(':id/documentos')
  @Roles('ADMIN', 'PRACTICANTE')
  @UseInterceptors(FileInterceptor('archivo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: { type: 'string', format: 'binary', description: 'PDF, PNG o JPEG' } } } })
  @ErrorCuerpoGrande()
  subir(
    @Param('id', Uuid) id: string,
    @Query() dto: DocumentoPracticanteDto,
    @UploadedFile() archivo?: Express.Multer.File,
  ): Promise<DocumentoPracticanteVista> {
    if (!archivo) {
      throw new BadRequestException('Falta el archivo (campo "archivo", multipart/form-data)');
    }
    return this.equipo.subirDocumentoPracticante(id, dto, archivo);
  }

  /** Descarga: el propio, ADMIN y GESTION; queda en registro_exportaciones. */
  @Get('documentos/:id')
  @Roles('ADMIN', 'GESTION', 'PRACTICANTE')
  @RespuestaArchivo('application/pdf', 'image/png', 'image/jpeg')
  async descargar(@Param('id', Uuid) id: string) {
    const r = await this.equipo.descargarDocumentoPracticante(id);
    return new StreamableFile(r.contenido, { type: r.tipoMime, disposition: `attachment; filename="${encodeURIComponent(r.nombreArchivo)}"` });
  }
}

/** Catalogo (B): todos leen; ADMIN escribe; nunca DELETE (se desactiva). */
@ApiTags(TAGS.equipo)
@Controller('tipos-atencion')
@Modulo('EQUIPO')
export class TiposAtencionController {
  constructor(private readonly equipo: EquipoService) {}

  @Get()
  @Roles(...TODOS)
  listar(): Promise<TipoAtencionVista[]> {
    return this.equipo.tiposAtencion();
  }

  /** Cola de propuestas de profesionales (PROPUESTO). */
  @Get('propuestas')
  @Roles('ADMIN')
  propuestas(): Promise<TipoAtencionProfesionalVista[]> {
    return this.equipo.propuestasTiposAtencion();
  }

  @Post()
  @Roles('ADMIN')
  crear(@Body() dto: TipoAtencionDto): Promise<TipoAtencionVista> {
    return this.equipo.crearTipoAtencion(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarTipoAtencionDto): Promise<TipoAtencionVista> {
    return this.equipo.editarTipoAtencion(id, dto);
  }
}

@ApiTags(TAGS.equipo)
@Controller()
@Modulo('EQUIPO')
export class SupervisionController {
  constructor(private readonly supervision: SupervisionService) {}

  @Get('supervisiones')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  supervisiones(): Promise<SupervisionVista[]> {
    return this.supervision.supervisiones();
  }

  /** Sin hueco: cierra y abre en la misma transaccion; avisa a los pacientes. */
  @Post('practicantes/:id/supervisor')
  @Roles('ADMIN')
  cambiarSupervisor(@Param('id', Uuid) id: string, @Body() dto: CambiarSupervisorDto): Promise<SupervisorCambiado> {
    return this.supervision.cambiarSupervisor(id, dto.supervisorId);
  }

  @Get('supervision/casos')
  @Roles('PROFESIONAL')
  casos(): Promise<CasoSupervision[]> {
    return this.supervision.casos();
  }

  @Get('supervision/casos/:codigo/evoluciones')
  @Roles('PROFESIONAL')
  evoluciones(@Param('codigo') codigo: string): Promise<EvolucionSupervisada[]> {
    return this.supervision.evoluciones(codigo);
  }

  @Post('supervision/evoluciones/:id/comentarios')
  @Roles('PROFESIONAL')
  comentar(@Param('id', Uuid) id: string, @Body() dto: ComentarioDto): Promise<ComentarioSupervision> {
    return this.supervision.comentar(id, dto.texto);
  }

  /** Los lee el tratante actual (incluido el practicante autor) y el supervisor vigente. */
  @Get('evoluciones/:id/comentarios')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  async comentarios(@Param('id', Uuid) id: string): Promise<ComentarioSupervision[]> {
    await this.supervision.exigirEvolucionVisible(id);
    return this.supervision.comentarios(id);
  }
}
