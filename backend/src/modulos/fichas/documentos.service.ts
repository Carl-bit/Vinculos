import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ForbiddenException, GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ModoEnvioDocumento, Prisma } from '@prisma/client';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { generarPdfDocumento } from '../../core/documentos/pdf';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import { EVENTOS, type NotificacionSolicitada } from '../../core/eventos/eventos';
import { armarPlantilla } from '../../core/notificaciones/notificaciones.service';
import type { EditarTipoDocumentoDto, EmitirDocumentoDto, TipoDocumentoDto } from './dto/fichas.dto';

/** Metadatos (sin contenido) para listas. */
const VISTA = {
  id: true,
  pacienteId: true,
  tipoDocumentoId: true,
  emitidoPorId: true,
  nombreArchivo: true,
  tipoMime: true,
  adjuntoSolicitadoEn: true,
  emitidoEn: true,
} satisfies Prisma.DocumentoClinicoSelect;

const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');

const nombreArchivo = (tipo: string) => `${tipo.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'documento'}.pdf`;

/**
 * Documentos clinicos (02h, 02i). Emitidos: el profesional redacta el texto;
 * el servidor lo arma con la plantilla del tipo de documento (solo sus
 * variables), lo guarda cifrado y genera el PDF con el formato del centro al
 * entregarlo (descarga o adjunto). Sin subida de archivos.
 *
 * Por correo (02h). Regla: el unico contenido clinico que
 * sale por correo son documentos emitidos por el tratante. Por defecto el
 * correo lleva un enlace que expira y exige iniciar sesion (cada descarga
 * queda registrada); el adjunto solo va si el paciente lo pidio explicitamente
 * (solicitud registrada). Cada envio queda en envios_documento y en
 * accesos_ficha. Los mensajes del paciente no cambian: el correo solo avisa.
 */
@Injectable()
export class DocumentosService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly eventos: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  tipos() {
    return this.bd.tx().tipoDocumentoClinico.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearTipo(dto: TipoDocumentoDto) {
    return this.bd
      .tx()
      .tipoDocumentoClinico.create({ data: dto })
      .catch((error: unknown) => {
        throw esSqlstate(error, '23505') ? conflicto('tipos_documento_clinico_nombre_key') : error;
      });
  }

  /** Nunca DELETE: se desactiva. */
  editarTipo(id: string, dto: EditarTipoDocumentoDto) {
    return this.bd.tx().tipoDocumentoClinico.update({ where: { id }, data: dto });
  }

  /**
   * Arma el texto con la plantilla del tipo (solo sus variables). Lo usan la
   * emision y la vista previa: el PDF de la vista previa es el mismo que se
   * entregara. Paciente ajeno -> 404 (RLS).
   */
  private async armar(dto: EmitirDocumentoDto) {
    const actor = this.bd.usuario();
    const tx = this.bd.tx();
    const [tipo, paciente, [profesional], centro] = await Promise.all([
      tx.tipoDocumentoClinico.findUnique({ where: { id: dto.tipoDocumentoId }, select: { nombre: true, plantilla: true, activo: true } }),
      tx.paciente.findUnique({ where: { id: dto.pacienteId }, select: { nombre: true, apellido: true } }),
      tx.$queryRaw<{ nombre: string | null }[]>`SELECT nombre FROM directorio_interno() WHERE id = ${actor.id}::uuid`,
      tx.configuracionCentro.findUniqueOrThrow({ where: { id: true }, select: { nombreCentro: true } }),
    ]);
    const t = encontrado(tipo, 'Tipo de documento');
    const p = encontrado(paciente, 'Paciente');
    // {{contenido}} es lo que redacta el profesional; el resto lo llena el servidor.
    const texto = armarPlantilla(t.plantilla, {
      nombre_paciente: `${p.nombre} ${p.apellido}`,
      nombre_profesional: profesional?.nombre ?? '',
      fecha: new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' }),
      nombre_centro: centro.nombreCentro,
      contenido: dto.contenido,
    });
    return { tipo: t, texto, nombreCentro: centro.nombreCentro };
  }

  /** Solo el tratante (RLS; PRACTICANTE con consentimiento). Tipo inactivo -> 403 (RLS). */
  async emitir(dto: EmitirDocumentoDto) {
    const actor = this.bd.usuario();
    const tx = this.bd.tx();
    const { tipo: t, texto } = await this.armar(dto);
    const doc = await tx.documentoClinico.create({
      data: {
        id: randomUUID(),
        pacienteId: dto.pacienteId,
        tipoDocumentoId: dto.tipoDocumentoId,
        emitidoPorId: actor.id,
        nombreArchivo: nombreArchivo(t.nombre),
        tipoMime: 'application/pdf',
        contenido: claro(texto),
      },
      select: VISTA,
    });
    await registrarAcceso(tx, actor, [{ pacienteId: doc.pacienteId, recurso: 'documentos_clinicos', accion: 'ESCRITURA' }]);
    return doc;
  }

  /**
   * Vista previa (03b-5): el PDF tal como se emitiria, sin guardar nada ni
   * enviar. No queda en accesos_ficha porque no lee datos clinicos guardados:
   * el texto lo acaba de redactar el propio tratante.
   */
  async vistaPrevia(dto: EmitirDocumentoDto): Promise<Buffer> {
    const { tipo, texto, nombreCentro } = await this.armar(dto);
    // Mismo resultado que emitir (ahi lo impone la RLS al insertar).
    if (!tipo.activo) throw new ForbiddenException('El tipo de documento esta desactivado');
    return generarPdfDocumento({ centro: nombreCentro, titulo: tipo.nombre, texto, emitidoEn: new Date() });
  }

  /** Copia del tratante (03b-5): el PDF de un documento ya emitido; la lectura queda en accesos_ficha. */
  async copia(id: string): Promise<{ nombreArchivo: string; pdf: Buffer }> {
    const tx = this.bd.tx();
    const doc = encontrado(await tx.documentoClinico.findUnique({ where: { id }, select: { pacienteId: true } }), 'Documento');
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId: doc.pacienteId, recurso: 'documentos_clinicos', accion: 'LECTURA' }]);
    return this.pdf(id);
  }

  /** Tratante: los de sus pacientes. PACIENTE: los suyos (RLS). */
  listar(pacienteId?: string) {
    return this.bd.tx().documentoClinico.findMany({ where: { pacienteId }, select: VISTA, orderBy: { emitidoEn: 'desc' } });
  }

  /**
   * Envio por correo. ENLACE: token de 256 bits; se guarda su SHA-256 (para
   * validar la descarga) y la URL cifrada (para el job de correo). ADJUNTO sin
   * solicitud del paciente -> 422 (trigger de la BD).
   */
  async enviar(id: string, modo: ModoEnvioDocumento = 'ENLACE') {
    const actor = this.bd.usuario();
    const tx = this.bd.tx();
    const doc = encontrado(await tx.documentoClinico.findUnique({ where: { id }, select: { id: true, pacienteId: true } }), 'Documento');
    const envioId = randomUUID();
    let enlace: { tokenHash: string; enlace: Uint8Array<ArrayBuffer>; expiraEn: Date } | undefined;
    if (modo === 'ENLACE') {
      const token = randomBytes(32).toString('base64url');
      const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
      const horas = this.config.getOrThrow<number>('DOCUMENTO_ENLACE_HORAS');
      enlace = {
        tokenHash: sha256(token),
        enlace: claro(`${base}/portal/documentos/descarga?token=${token}`),
        expiraEn: new Date(Date.now() + horas * 3_600_000),
      };
    }
    const envio = await tx.envioDocumento.create({
      data: { id: envioId, documentoId: doc.id, modo, enviadoPorId: actor.id, ...enlace },
      select: { id: true, documentoId: true, modo: true, expiraEn: true, enviadoEn: true },
    });
    await registrarAcceso(tx, actor, [{ pacienteId: doc.pacienteId, recurso: 'envios_documento', accion: 'ENVIO' }]);
    const evento: NotificacionSolicitada = { actor, tipo: 'DOCUMENTO_CLINICO', destino: { pacienteId: doc.pacienteId }, referenciaId: envio.id };
    this.bd.alConfirmar(() => this.eventos.emitAsync(EVENTOS.NOTIFICACION_SOLICITADA, evento));
    return envio;
  }

  envios(documentoId: string) {
    return this.bd.tx().envioDocumento.findMany({
      where: { documentoId },
      select: { id: true, modo: true, expiraEn: true, enviadoPorId: true, enviadoEn: true, descargas: { select: { usuarioId: true, descargadoEn: true } } },
      orderBy: { enviadoEn: 'desc' },
    });
  }

  /** El paciente pide recibirlo adjunto (queda registrado; una vez). */
  async solicitarAdjunto(id: string) {
    await this.bd.tx().$executeRaw`SELECT solicitar_adjunto_documento(${id}::uuid)`;
    return encontrado(await this.bd.tx().documentoClinico.findUnique({ where: { id }, select: VISTA }), 'Documento');
  }

  /** Descarga por enlace: el paciente con sesion; vencido -> 410 (no se registra). Devuelve el PDF. */
  async descargar(token: string): Promise<{ nombreArchivo: string; pdf: Buffer }> {
    const [r] = await this.bd.tx().$queryRaw<[{ documento_id: string; vencido: boolean }]>`
      SELECT documento_id, vencido FROM registrar_descarga_documento(${sha256(token)})`;
    if (r.vencido) {
      throw new GoneException('El enlace del documento vencio: pida uno nuevo al centro');
    }
    return this.pdf(r.documento_id);
  }

  /**
   * Antes de 03b-4: descarga desde el portal con sesion (sin el enlace del
   * correo). registrar_descarga_portal valida que sea suyo o de un menor a
   * cargo (el adolescente no) y registra la descarga igual que el enlace.
   */
  async descargarPortal(id: string): Promise<{ nombreArchivo: string; pdf: Buffer }> {
    await this.bd.tx().$queryRaw`SELECT registrar_descarga_portal(${id}::uuid)`;
    return this.pdf(id);
  }

  private async pdf(documentoId: string): Promise<{ nombreArchivo: string; pdf: Buffer }> {
    const tx = this.bd.tx();
    const doc = encontrado(
      await tx.documentoClinico.findUnique({
        where: { id: documentoId },
        select: { nombreArchivo: true, contenido: true, emitidoEn: true, tipoDocumento: { select: { nombre: true } } },
      }),
      'Documento',
    );
    const { nombreCentro } = await tx.configuracionCentro.findUniqueOrThrow({ where: { id: true }, select: { nombreCentro: true } });
    const pdf = await generarPdfDocumento({ centro: nombreCentro, titulo: doc.tipoDocumento.nombre, texto: texto(doc.contenido), emitidoEn: doc.emitidoEn });
    return { nombreArchivo: doc.nombreArchivo, pdf };
  }
}
