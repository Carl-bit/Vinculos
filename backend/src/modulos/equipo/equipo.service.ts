import { randomUUID } from 'node:crypto';

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { registrarExportacion } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import { procesarImagenPublica } from '../../core/imagenes/imagenes';
import { nombreArchivo, tipoPorContenido } from '../../core/validacion/archivos';
import type {
  CorregirCampoDto,
  DatosPrivadosDto,
  DocumentoPracticanteDto,
  EditarPerfilDto,
  EditarTipoAtencionDto,
  PedirCorreccionDto,
  PerfilDto,
  TarifaDto,
  TipoAtencionDto,
  TrayectoriaDto,
} from './dto/equipo.dto';

const VISTA_PRIVADOS = {
  usuarioId: true,
  rut: true,
  banco: true,
  tipoCuenta: true,
  numeroCuenta: true,
  titular: true,
  updatedAt: true,
} satisfies Prisma.ProfesionalDatosPrivadosSelect;

type Privados = Prisma.ProfesionalDatosPrivadosGetPayload<{ select: typeof VISTA_PRIVADOS }>;

/** Respaldos del titulo (sin el contenido), del mas reciente al mas antiguo. */
const SIN_CONTENIDO = {
  id: true,
  practicanteId: true,
  tipo: true,
  nombreArchivo: true,
  tipoMime: true,
  tamanoBytes: true,
  vigenteHasta: true,
  subidoPorId: true,
  subidoEn: true,
} satisfies Prisma.PracticanteDocumentoSelect;

const CON_RESPALDOS = {
  respaldos: {
    select: { id: true, nombreArchivo: true, tipoMime: true, tamanoBytes: true, subidoEn: true },
    orderBy: { subidoEn: 'desc' },
  },
} satisfies Prisma.ProfesionalTrayectoriaInclude;

const vistaPrivados = (d: Privados) => ({
  usuarioId: d.usuarioId,
  rut: texto(d.rut),
  banco: texto(d.banco),
  tipoCuenta: texto(d.tipoCuenta),
  numeroCuenta: texto(d.numeroCuenta),
  titular: texto(d.titular),
  updatedAt: d.updatedAt,
});

/**
 * Perfil profesional autogestionado (requisitos_02_apis.md 6): perfil
 * publico, trayectoria (ADMIN verifica), datos privados cifrados, tarifas
 * (historial, sin UPDATE) y tipos de atencion (catalogo de ADMIN).
 */
@Injectable()
export class EquipoService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  async perfil(profesionalId: string) {
    return encontrado(await this.bd.tx().profesional.findUnique({ where: { usuarioId: profesionalId } }), 'Perfil');
  }

  /** El propio PROFESIONAL crea o edita su perfil (publicar exige tarifa general: 422). */
  guardarMiPerfil(dto: PerfilDto) {
    const usuarioId = this.bd.usuario().id;
    return this.bd.tx().profesional.upsert({ where: { usuarioId }, create: { usuarioId, ...dto }, update: dto });
  }

  /** ADMIN/GESTION corrigen el perfil; publicarlo es solo del propio (403). */
  async editarPerfil(profesionalId: string, dto: EditarPerfilDto) {
    await this.perfil(profesionalId);
    return this.bd.tx().profesional.update({ where: { usuarioId: profesionalId }, data: dto });
  }

  /**
   * Foto de perfil (03a): imagen publica validada por contenido,
   * redimensionada y sin metadatos; el perfil apunta a su URL publica.
   */
  async subirFoto(profesionalId: string, archivo: Buffer) {
    await this.perfil(profesionalId);
    const img = await procesarImagenPublica(archivo);
    const tx = this.bd.tx();
    const { id } = await tx.imagenPublica.create({
      data: {
        tipo: 'FOTO_PERFIL',
        usuarioId: profesionalId,
        tipoMime: img.tipoMime,
        ancho: img.ancho,
        alto: img.alto,
        tamanoBytes: img.contenido.length,
        contenido: new Uint8Array(img.contenido),
      },
      select: { id: true },
    });
    const fotoUrl = `/api/publico/imagenes/${id}`;
    await tx.profesional.update({ where: { usuarioId: profesionalId }, data: { fotoUrl } });
    return { imagenId: id, fotoUrl };
  }

  /** Reseñas recibidas (D-1): todas sus estados y el feedback privado, solo para el propio. */
  async misResenas() {
    const filas = await this.bd.tx().resena.findMany({
      where: { profesionalId: this.bd.usuario().id },
      select: { id: true, calificacion: true, texto: true, feedbackPrivado: true, estado: true, mostrarComo: true, creadaEn: true, editadaEn: true },
      orderBy: { creadaEn: 'desc' },
    });
    return filas.map((r) => ({ ...r, texto: texto(r.texto), feedbackPrivado: texto(r.feedbackPrivado) }));
  }

  /**
   * Margen de traslado (el propio y ADMIN/GESTION). Cambiarlo no mueve citas:
   * GET /profesionales/:id/conflictos-margen lista las que quedan en conflicto.
   */
  async margen(profesionalId: string, margenTrasladoMin: number | null) {
    await this.perfil(profesionalId);
    return this.bd.tx().profesional.update({ where: { usuarioId: profesionalId }, data: { margenTrasladoMin } });
  }

  trayectoria(profesionalId: string) {
    return this.bd.tx().profesionalTrayectoria.findMany({
      where: { profesionalId },
      include: CON_RESPALDOS,
      orderBy: [{ anio: 'desc' }, { titulo: 'asc' }],
    });
  }

  crearTrayectoria(dto: TrayectoriaDto) {
    return this.bd.tx().profesionalTrayectoria.create({ data: { profesionalId: this.bd.usuario().id, ...dto }, include: CON_RESPALDOS });
  }

  /**
   * Respaldo del titulo (2026-11-07, docs/api/respaldo_titulos.md): solo el
   * propio; tipo por contenido (PDF, PNG o JPEG; si no 422); archivo cifrado
   * (IDENTIFICACION, id generado aqui para el AAD). La funcion de la BD crea
   * una version nueva y deja el titulo "En revision".
   */
  async subirRespaldo(trayectoriaId: string, archivo: Express.Multer.File) {
    const tipoMime = tipoPorContenido(archivo.buffer);
    if (!tipoMime) {
      throw new UnprocessableEntityException({
        message: 'El respaldo debe ser PDF, PNG o JPEG (validado por contenido)',
        restriccion: 'trayectoria_respaldos_archivo',
      });
    }
    const id = randomUUID();
    const contenido = this.llavero.cifrarCampo(archivo.buffer.toString('base64'), 'trayectoria_respaldos', 'contenido', id);
    const tx = this.bd.tx();
    await tx.$queryRaw`
      SELECT subir_respaldo_trayectoria(${id}::uuid, ${trayectoriaId}::uuid, ${nombreArchivo(archivo.originalname, 'respaldo')},
                                        ${tipoMime}, ${archivo.size}::int, ${contenido})`;
    return encontrado(await tx.profesionalTrayectoria.findUnique({ where: { id: trayectoriaId }, include: CON_RESPALDOS }), 'Trayectoria');
  }

  /** Descarga: el propio y ADMIN/GESTION (RLS); queda en registro_exportaciones. */
  async descargarRespaldo(id: string) {
    const tx = this.bd.tx();
    const r = encontrado(
      await tx.trayectoriaRespaldo.findUnique({ where: { id }, select: { nombreArchivo: true, tipoMime: true, contenido: true } }),
      'Respaldo',
    );
    await registrarExportacion(tx, this.bd.usuario(), { recurso: 'trayectoria_respaldos', referenciaId: id });
    return { nombreArchivo: r.nombreArchivo, tipoMime: r.tipoMime, contenido: Buffer.from(texto(r.contenido) ?? '', 'base64') };
  }

  /**
   * Observacion de la cuenta madre sobre el respaldo (2026-11-08): el titulo
   * vuelve a revision; la limpia un respaldo nuevo o verificarlo (BD).
   */
  async observarTrayectoria(id: string, observacion: string) {
    const tx = this.bd.tx();
    await tx.$executeRaw`SELECT observar_trayectoria(${id}::uuid, ${observacion})`;
    return encontrado(await tx.profesionalTrayectoria.findUnique({ where: { id }, include: CON_RESPALDOS }), 'Trayectoria');
  }

  /** Documentos del practicante (2026-11-08): el propio, ADMIN y GESTION (RLS); sin el contenido. */
  documentosPracticante(practicanteId: string) {
    return this.bd.tx().practicanteDocumento.findMany({ where: { practicanteId }, select: SIN_CONTENIDO, orderBy: { subidoEn: 'desc' } });
  }

  /**
   * Certificado de alumno regular o convenio de practica: PDF, PNG o JPEG por
   * contenido (422), cifrado (IDENTIFICACION). Version nueva, nunca reemplaza.
   * Suben el propio practicante o ADMIN (la BD decide: 42501 -> 403).
   */
  async subirDocumentoPracticante(practicanteId: string, dto: DocumentoPracticanteDto, archivo: Express.Multer.File) {
    const tipoMime = tipoPorContenido(archivo.buffer);
    if (!tipoMime) {
      throw new UnprocessableEntityException({
        message: 'El documento debe ser PDF, PNG o JPEG (validado por contenido)',
        restriccion: 'practicante_documentos_archivo',
      });
    }
    const id = randomUUID();
    const contenido = this.llavero.cifrarCampo(archivo.buffer.toString('base64'), 'practicante_documentos', 'contenido', id);
    const tx = this.bd.tx();
    await tx.$queryRaw`
      SELECT subir_documento_practicante(${id}::uuid, ${practicanteId}::uuid, ${dto.tipo}::tipo_documento_practicante,
                                         ${nombreArchivo(archivo.originalname, 'documento')}, ${tipoMime}, ${archivo.size}::int,
                                         ${contenido}, ${dto.vigenteHasta ?? null}::date)`;
    return encontrado(await tx.practicanteDocumento.findUnique({ where: { id }, select: SIN_CONTENIDO }), 'Documento');
  }

  /** Descarga: el propio, ADMIN y GESTION; queda en registro_exportaciones. */
  async descargarDocumentoPracticante(id: string) {
    const tx = this.bd.tx();
    const r = encontrado(
      await tx.practicanteDocumento.findUnique({ where: { id }, select: { nombreArchivo: true, tipoMime: true, contenido: true } }),
      'Documento',
    );
    await registrarExportacion(tx, this.bd.usuario(), { recurso: 'practicante_documentos', referenciaId: id });
    return { nombreArchivo: r.nombreArchivo, tipoMime: r.tipoMime, contenido: Buffer.from(texto(r.contenido) ?? '', 'base64') };
  }

  /** Pedidos y correcciones del perfil publico (ADMIN/GESTION todos; el profesional los suyos). */
  correcciones(profesionalId: string) {
    return this.bd.tx().correccionPerfil.findMany({
      where: { profesionalId },
      select: { id: true, profesionalId: true, campo: true, accion: true, motivo: true, autorId: true, creadaEn: true },
      orderBy: { creadaEn: 'desc' },
      take: 50,
    });
  }

  /** La cuenta madre pide corregir campos; devuelve cuantas veces se pidio cada uno sin cambios. */
  pedirCorreccion(profesionalId: string, dto: PedirCorreccionDto) {
    return this.bd.tx().$queryRaw<{ campo: string; solicitudes: number }[]>`
      SELECT campo, solicitudes FROM pedir_correccion_perfil(${profesionalId}::uuid, ${dto.campos}::text[], ${dto.motivo})`;
  }

  /** A la segunda solicitud del mismo campo sin cambios, la cuenta madre lo corrige (422 si no corresponde). */
  async corregirCampo(profesionalId: string, dto: CorregirCampoDto) {
    await this.bd.tx().$executeRaw`SELECT corregir_campo_perfil(${profesionalId}::uuid, ${dto.campo}, ${dto.valor}, ${dto.motivo})`;
    return this.perfil(profesionalId);
  }

  /** Cualquier edicion del propio la des-verifica (trigger). */
  async editarTrayectoria(id: string, dto: TrayectoriaDto) {
    const tx = this.bd.tx();
    encontrado(await tx.profesionalTrayectoria.findFirst({ where: { id, profesionalId: this.bd.usuario().id } }), 'Trayectoria');
    return tx.profesionalTrayectoria.update({ where: { id }, data: dto, include: CON_RESPALDOS });
  }

  async eliminarTrayectoria(id: string) {
    const { count } = await this.bd.tx().profesionalTrayectoria.deleteMany({ where: { id, profesionalId: this.bd.usuario().id } });
    encontrado(count || null, 'Trayectoria');
    return { eliminados: count };
  }

  /** Solo ADMIN (trigger: ADMIN solo toca la verificacion). */
  async verificarTrayectoria(id: string, verificado: boolean) {
    const tx = this.bd.tx();
    encontrado(await tx.profesionalTrayectoria.findUnique({ where: { id } }), 'Trayectoria');
    return tx.profesionalTrayectoria.update({ where: { id }, data: { verificado }, include: CON_RESPALDOS });
  }

  /** Lectura del propio y ADMIN/GESTION (RLS). Si no es el titular, queda en registro_exportaciones (2026-11-05). */
  async datosPrivados(profesionalId: string) {
    const tx = this.bd.tx();
    const fila = encontrado(await tx.profesionalDatosPrivados.findUnique({ where: { usuarioId: profesionalId }, select: VISTA_PRIVADOS }), 'Datos privados');
    const usuario = this.bd.usuario();
    if (usuario.id !== profesionalId) await registrarExportacion(tx, usuario, { recurso: 'profesional_datos_privados', referenciaId: profesionalId });
    return vistaPrivados(fila);
  }

  /** Solo el propio (PROFESIONAL o PRACTICANTE). RUT con indice ciego unico. */
  async guardarMisDatosPrivados(dto: DatosPrivadosDto) {
    const usuarioId = this.bd.usuario().id;
    const datos = {
      rut: claro(dto.rut),
      rutHmac: dto.rut ? this.llavero.hmacRut(dto.rut) : undefined,
      banco: claro(dto.banco),
      tipoCuenta: claro(dto.tipoCuenta),
      numeroCuenta: claro(dto.numeroCuenta),
      titular: claro(dto.titular),
    };
    const fila = await this.bd
      .tx()
      .profesionalDatosPrivados.upsert({ where: { usuarioId }, create: { usuarioId, ...datos }, update: datos, select: VISTA_PRIVADOS })
      .catch((error: unknown) => {
        throw esSqlstate(error, '23505') ? conflicto('profesional_datos_privados_rut_hmac_key') : error;
      });
    return vistaPrivados(fila);
  }

  tarifas(profesionalId: string) {
    return this.bd.tx().tarifa.findMany({ where: { profesionalId }, orderBy: [{ vigenteDesde: 'desc' }, { createdAt: 'desc' }] });
  }

  /** Historial: una tarifa nueva es una fila nueva (sin UPDATE ni DELETE). */
  crearTarifa(dto: TarifaDto) {
    return this.bd.tx().tarifa.create({ data: { profesionalId: this.bd.usuario().id, ...dto } });
  }

  tiposAtencion() {
    return this.bd.tx().tipoAtencion.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearTipoAtencion(dto: TipoAtencionDto) {
    return this.bd.tx().tipoAtencion.create({ data: dto });
  }

  editarTipoAtencion(id: string, dto: EditarTipoAtencionDto) {
    return this.bd.tx().tipoAtencion.update({ where: { id }, data: dto });
  }

  /** ADMIN: fija la lista aprobada (reemplaza todo, incluidas propuestas pendientes). */
  async asignarTiposAtencion(profesionalId: string, tipoAtencionIds: string[]) {
    const tx = this.bd.tx();
    await tx.profesionalTipoAtencion.deleteMany({ where: { profesionalId } });
    await tx.profesionalTipoAtencion.createMany({
      data: tipoAtencionIds.map((tipoAtencionId) => ({ profesionalId, tipoAtencionId, estado: 'APROBADO' as const })),
    });
    return this.tiposDe(profesionalId);
  }

  /**
   * El propio PROFESIONAL propone un tipo de atencion (queda PROPUESTO aunque
   * pida otro estado: trigger). Solo cuenta en el match, el perfil publico y
   * el directorio cuando ADMIN lo aprueba.
   */
  async proponerTipoAtencion(tipoAtencionId: string) {
    const profesionalId = this.bd.usuario().id;
    await this.bd
      .tx()
      .profesionalTipoAtencion.create({ data: { profesionalId, tipoAtencionId }, select: { profesionalId: true } })
      .catch((error: unknown) => {
        throw esSqlstate(error, '23505') ? conflicto('profesional_tipos_atencion_pkey') : error;
      });
    return this.tiposDe(profesionalId);
  }

  tiposDe(profesionalId: string) {
    return this.bd.tx().profesionalTipoAtencion.findMany({ where: { profesionalId }, orderBy: { createdAt: 'asc' } });
  }

  /** Cola de ADMIN: propuestas pendientes de todos los profesionales. */
  propuestasTiposAtencion() {
    return this.bd.tx().profesionalTipoAtencion.findMany({ where: { estado: 'PROPUESTO' }, orderBy: { createdAt: 'asc' } });
  }

  /** Solo ADMIN (RLS + trigger registran quien y cuando). */
  async revisarTipoAtencion(profesionalId: string, tipoAtencionId: string, estado: 'APROBADO' | 'RECHAZADO') {
    const where = { profesionalId_tipoAtencionId: { profesionalId, tipoAtencionId } };
    encontrado(await this.bd.tx().profesionalTipoAtencion.findUnique({ where }), 'Propuesta');
    return this.bd.tx().profesionalTipoAtencion.update({ where, data: { estado } });
  }
}
