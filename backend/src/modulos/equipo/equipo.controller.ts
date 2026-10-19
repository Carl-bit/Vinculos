import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../core/docs/openapi';
import { Actor, Roles } from '../../core/auth/decoradores';
import { Modulo } from '../../core/modulos/modulos';
import type { UsuarioActual } from '../../core/bd/contexto-bd.service';
import { IMAGEN_MAX_BYTES } from '../../core/imagenes/imagenes';
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
import {
  DatosPrivadosVista,
  FotoSubida,
  MiResenaRecibida,
  PerfilProfesionalVista,
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
  constructor(private readonly equipo: EquipoService) {}

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

  /** ADMIN sube la foto de otro integrante. */
  @Post(':id/foto')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('imagen', { limits: { fileSize: IMAGEN_MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['imagen'], properties: { imagen: { type: 'string', format: 'binary' } } } })
  subirFoto(@Param('id', Uuid) id: string, @UploadedFile() imagen?: Express.Multer.File): Promise<FotoSubida> {
    return this.equipo.subirFoto(id, exigirImagen(imagen));
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

  @Post(':id/verificacion')
  @Roles('ADMIN')
  verificar(@Param('id', Uuid) id: string, @Body() dto: VerificarTrayectoriaDto): Promise<TrayectoriaVista> {
    return this.equipo.verificarTrayectoria(id, dto.verificado);
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
