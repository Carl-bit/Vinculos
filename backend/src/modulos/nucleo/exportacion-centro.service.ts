import { createCipheriv, createHash, randomBytes, type CipherGCM } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { CAMPOS_CIFRADOS } from '../../common/crypto/registro';
import { ContextoBd, type Tx, type UsuarioActual } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { generarPdfDocumento } from '../../core/documentos/pdf';
import { JobsService, type ResultadoJob } from '../../core/jobs/jobs.service';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import { llaveParaCifrar, MAGIA_V2, POS_TAG_V2, publicaDesdeClave } from './cifrado-exportacion';
import type { ExportacionCentroVista } from './dto/nucleo.dto';
import { textoLegible, VERSION_EXPORTACION } from './exportaciones.service';

/** Filas por lote; las tablas con archivos van de a una (un adjunto puede pesar ADJUNTO_MAX_MB). */
const LOTE = 200;
const TABLAS_CON_ARCHIVOS = new Set(['adjuntos_ficha', 'documentos_clinicos', 'imagenes_publicas', 'practicante_documentos', 'trayectoria_respaldos']);
/** La lectura completa corre en una sola transaccion de solo lectura (snapshot consistente). */
const TIEMPO_MAXIMO_MS = 3 * 60 * 60_000;

type Fila = Record<string, unknown>;
type Tomada = { id: string; solicitada_por_id: string; clave_publica: Buffer; sal: Buffer; intentos: number };

/**
 * AUD-02 (BD-05, COLA-01): exportacion completa del centro (LEG-04) como job
 * programado.
 *
 * Al pedirla, la clave del ADMIN deriva un par X25519: la BD guarda solo la
 * publica y la sal (cifrado-exportacion.ts); la clave y la privada se
 * descartan. Queda PENDIENTE para la ventana nocturna del centro
 * (proxima_ventana_exportacion: 1 h antes de la apertura, dentro de 24 h) o,
 * si es urgente (baja de un centro), para ya.
 *
 * Un job cada 5 minutos toma la que vencio (tomar_exportacion_centro, una a
 * la vez) y, en el contexto del ADMIN que la pidio:
 * - lee las tablas por lotes en una transaccion REPEATABLE READ de solo lectura,
 * - descifra cada lote y lo escribe cifrado por flujo con la publica (formato
 *   v2) en el volumen del silo; despues, un PDF por ficha,
 * - informa el avance en transacciones cortas aparte.
 * Memoria acotada por lote; nunca el centro completo.
 *
 * Como no necesita la clave, un reinicio o un error no la pierden: vuelve a
 * PENDIENTE y se reintenta desde cero (3 intentos; despues FALLIDA y correo).
 * El archivo se borra al descargarlo o a las 24 h.
 *
 * ponytail: un job a la vez en el proceso de la API (una sola replica). Con
 * varias replicas, el reinicio de una no debe devolver a PENDIENTE la que
 * corre en otra: registrar la instancia en la fila.
 */
@Injectable()
export class ExportacionCentroService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExportacionCentroService.name);
  private readonly carpeta: string;
  private corriendo: Promise<void> | null = null;

  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
    private readonly jobs: JobsService,
    config: ConfigService,
  ) {
    this.carpeta = config.get<string>('EXPORTACIONES_DIR') || join(tmpdir(), 'vinculos-exportaciones');
  }

  // --- Peticiones (dentro de la transaccion RLS del interceptor) -------------

  async solicitar(clave: string, urgente: boolean): Promise<ExportacionCentroVista> {
    const sal = randomBytes(16);
    // La clave no se guarda ni sale de aqui: solo su llave publica (cifra, no abre).
    const publica = publicaDesdeClave(clave, sal);
    // Otra pedida sin terminar: 55000 (exportaciones_centro_una_en_proceso) -> 409 con su texto en el filtro global.
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT iniciar_exportacion_centro(${publica}, ${sal}, ${urgente}) AS id`;
    if (urgente) this.bd.alConfirmar(() => void this.procesarPendientes());
    return this.vista(id);
  }

  async listar(): Promise<ExportacionCentroVista[]> {
    const filas = await this.bd.tx().exportacionCentro.findMany({ orderBy: { creadaEn: 'desc' }, take: 10 });
    const yo = this.bd.usuario().id;
    return filas.map((f) => aVista(f, yo));
  }

  async vista(id: string): Promise<ExportacionCentroVista> {
    const f = await this.bd.tx().exportacionCentro.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Exportación no encontrada');
    return aVista(f, this.bd.usuario().id);
  }

  /**
   * Archivo listo para descargar (solo quien la pidio, dentro de las 24 h).
   * `alTerminar` marca la descarga y borra el archivo cuando el envio termino
   * completo (una descarga cortada no lo pierde).
   */
  async archivo(id: string): Promise<{ ruta: string; nombre: string; alTerminar: () => Promise<void> }> {
    const usuario = this.bd.usuario();
    const f = await this.bd.tx().exportacionCentro.findUnique({ where: { id } });
    if (!f || f.solicitadaPorId !== usuario.id) throw new NotFoundException('Exportación no encontrada');
    if (f.estado !== 'LISTA' || !f.venceEn || f.venceEn <= new Date()) {
      throw new ConflictException('La exportación no está disponible para descargar.');
    }
    const ruta = this.ruta(id);
    await stat(ruta).catch(() => {
      throw new NotFoundException('El archivo de la exportación ya no está disponible');
    });
    const fecha = (f.terminadaEn ?? new Date()).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
    return {
      ruta,
      nombre: `exportacion-centro-${fecha}.vxp`,
      alTerminar: async () => {
        await this.comoAdmin({ id: usuario.id, rol: usuario.rol }, (tx) => tx.$executeRaw`SELECT descargar_exportacion_centro(${id}::uuid)`);
        await rm(ruta, { force: true });
      },
    };
  }

  // --- Job -------------------------------------------------------------------

  /** Al arrancar: las EN_PROCESO de un proceso anterior vuelven a PENDIENTE y se retoman. */
  async onApplicationBootstrap(): Promise<void> {
    await this.cerrar(true).catch((e: Error) => this.logger.error(`No se pudieron retomar exportaciones interrumpidas: ${e.name}`));
    void this.procesarPendientes();
  }

  /** Vencidas (24 h) y sus archivos. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'vencer_exportaciones_centro' })
  vencer(): Promise<ResultadoJob> {
    return this.cerrar(false);
  }

  /** Programadas cuya hora llego (y reintentos). */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'exportaciones_centro_pendientes' })
  revisar(): Promise<void> {
    return this.procesarPendientes();
  }

  /**
   * Corre las pendientes vencidas, una tras otra. Si ya hay una corrida en este
   * proceso, espera esa (publico para los tests: esperar a que termine).
   */
  procesarPendientes(): Promise<void> {
    this.corriendo ??= (async () => {
      try {
        for (;;) {
          const [t] = await this.bd.sinContexto('job').$queryRaw<Tomada[]>`SELECT * FROM tomar_exportacion_centro()`;
          if (!t) break;
          await this.correr(t);
        }
      } catch (e) {
        this.logger.error(`No se pudo tomar una exportacion pendiente: ${(e as Error).name}`);
      } finally {
        this.corriendo = null;
      }
    })();
    return this.corriendo;
  }

  private cerrar(interrumpidas: boolean): Promise<ResultadoJob> {
    return this.jobs.conLock('cerrar_exportaciones_centro', async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>`SELECT cerrar_exportaciones_centro(${interrumpidas}) AS id`;
      await Promise.all(ids.map(({ id }) => rm(this.ruta(id), { force: true })));
      return ids.length;
    });
  }

  private async correr(t: Tomada): Promise<void> {
    const usuario: UsuarioActual = { id: t.solicitada_por_id, rol: 'ADMIN' };
    const ruta = this.ruta(t.id);
    let escritor: EscritorCifrado | undefined;
    try {
      await mkdir(this.carpeta, { recursive: true, mode: 0o700 });
      await rm(ruta, { force: true }); // restos de un intento anterior
      escritor = await EscritorCifrado.abrir(ruta, t.sal, t.clave_publica);
      const e = escritor;
      await this.bd.sinContexto('job').$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${usuario.id}, true), set_config('app.current_rol', ${usuario.rol}, true)`;
          await this.escribirCentro(tx, t.id, usuario, e);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 30_000, timeout: TIEMPO_MAXIMO_MS },
      );
      const bytes = await escritor.cerrar();
      escritor = undefined;
      const huella = await sha256(ruta);
      const [{ vence }] = await this.comoAdmin(
        usuario,
        (tx) => tx.$queryRaw<[{ vence: Date }]>`SELECT terminar_exportacion_centro(${t.id}::uuid, ${bytes}::bigint, ${huella}) AS vence`,
      );
      await this.avisar(
        usuario,
        `Tu exportación del centro está lista. Descárgala desde Configuración > Exportación antes del ${formatoFecha(vence)}; después se borra.`,
      );
    } catch (error) {
      this.logger.error(`Exportacion del centro fallida (intento ${t.intentos}): ${(error as { name?: string }).name ?? 'Error'}`);
      await escritor?.descartar();
      await rm(ruta, { force: true });
      // Hasta el tercer intento vuelve a PENDIENTE (en 10 minutos); despues FALLIDA y aviso.
      const [r] = await this.comoAdmin(
        usuario,
        (tx) => tx.$queryRaw<{ estado: string }[]>`
          SELECT fallar_exportacion_centro(${t.id}::uuid, ${'No se pudo completar la exportación tras tres intentos. Vuelve a pedirla.'})::text AS estado`,
      ).catch(() => [undefined]);
      if (r?.estado === 'FALLIDA') {
        await this.avisar(usuario, 'No se pudo completar la exportación del centro tras tres intentos. Vuelve a pedirla desde Configuración > Exportación.');
      }
    }
  }

  private async escribirCentro(tx: Tx, id: string, usuario: UsuarioActual, e: EscritorCifrado): Promise<void> {
    const [{ c }] = await tx.$queryRaw<[{ c: { nombre_centro: string } }]>`SELECT contenido_publico_centro() AS c`;
    const centro = c?.nombre_centro ?? 'Centro';
    const tablas = (await tx.$queryRaw<{ t: string }[]>`SELECT t FROM tablas_exportacion_centro() AS t`).map((x) => x.t);
    const pacientes = (await tx.$queryRaw<{ id: string }[]>`SELECT pacientes_con_ficha_exportacion() AS id`).map((x) => x.id);
    const avance = (tablasHechas: number, fichasHechas: number) =>
      this.comoAdmin(
        usuario,
        (t) => t.$executeRaw`SELECT avance_exportacion_centro(${id}::uuid, ${tablasHechas}::int, ${fichasHechas}::int, ${pacientes.length}::int)`,
      );

    await e.escribir(
      `{"formato":"vinculos-exportacion-centro","version":${VERSION_EXPORTACION},"generadoEn":${JSON.stringify(new Date().toISOString())},"centro":${JSON.stringify(centro)},"datos":{`,
    );
    for (const [i, tabla] of tablas.entries()) {
      await e.escribir(`${i ? ',' : ''}${JSON.stringify(tabla)}:[`);
      const limite = TABLAS_CON_ARCHIVOS.has(tabla) ? 1 : LOTE;
      let despues: string | null = null;
      let primera = true;
      for (;;) {
        const lote: { fila: Fila; pos: string }[] = await tx.$queryRaw`
          SELECT fila, pos::text AS pos FROM exportar_tabla_centro_lote(${tabla}, ${despues}::tid, ${limite}::int)`;
        for (const { fila } of lote) {
          await e.escribir(`${primera ? '' : ','}${JSON.stringify(this.descifrar(tabla, fila))}`);
          primera = false;
        }
        if (lote.length < limite) break;
        despues = lote[lote.length - 1].pos;
      }
      await e.escribir(']');
      await avance(i + 1, 0);
    }
    await e.escribir('},"fichasPdf":{');
    for (const [i, pacienteId] of pacientes.entries()) {
      const [{ d }] = await tx.$queryRaw<[{ d: Record<string, Fila[]> }]>`SELECT exportar_ficha_centro(${pacienteId}::uuid) AS d`;
      const legible = Object.fromEntries(Object.entries(d).map(([t, filas]) => [t, filas.map((f) => this.descifrar(t, f))]));
      const pdf = await generarPdfDocumento({ centro, titulo: 'Ficha clinica', texto: textoLegible(legible), emitidoEn: new Date() });
      await e.escribir(`${i ? ',' : ''}${JSON.stringify(pacienteId)}:${JSON.stringify(pdf.toString('base64'))}`);
      if ((i + 1) % 20 === 0 || i + 1 === pacientes.length) await avance(tablas.length, i + 1);
    }
    await e.escribir('}}');
  }

  /** Columnas cifradas (bytea como "\\x..." en el JSON) -> texto, con el AAD de su fila. */
  private descifrar(tabla: string, fila: Fila): Fila {
    const campos = CAMPOS_CIFRADOS.filter((c) => c.tabla === tabla);
    if (!campos.length) return fila;
    const copia = { ...fila };
    for (const c of campos) {
      const v = copia[c.columna];
      if (typeof v === 'string' && v.startsWith('\\x')) {
        copia[c.columna] = this.llavero.descifrarCampo(Buffer.from(v.slice(2), 'hex'), tabla, c.columna, String(fila[c.id]));
      }
    }
    return copia;
  }

  /** Transaccion corta en el contexto del ADMIN que pidio la exportacion (avance, termino, descarga). */
  private comoAdmin<T>(usuario: UsuarioActual, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.bd.sinContexto('job').$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${usuario.id}, true), set_config('app.current_rol', ${usuario.rol}, true)`;
      return fn(tx);
    });
  }

  private async avisar(usuario: UsuarioActual, texto: string): Promise<void> {
    try {
      const u = await this.comoAdmin(usuario, (tx) => tx.usuario.findUnique({ where: { id: usuario.id }, select: { email: true } }));
      if (u?.email) await this.correos.enviarAviso(u.email, 'Exportación del centro', texto);
    } catch {
      this.logger.warn('No se pudo avisar el resultado de la exportacion del centro');
    }
  }

  private ruta(id: string): string {
    return join(this.carpeta, `${id}.vxp`);
  }
}

/**
 * Archivo cifrado por flujo: cabecera con el tag en cero, cuerpo cifrado a
 * medida que llega y, al cerrar, el tag de GCM en su posicion. Las escrituras
 * se esperan una a una: la memoria queda acotada a un lote.
 */
class EscritorCifrado {
  private constructor(
    private readonly archivo: FileHandle,
    private readonly cifrador: CipherGCM,
    private bytes: number,
  ) {}

  /** Formato v2: MAGIA_V2 | sal(16) | publica efimera(32) | iv(12) | tag(16, se escribe al cerrar) | cuerpo. */
  static async abrir(ruta: string, sal: Buffer, publicaAdmin: Buffer): Promise<EscritorCifrado> {
    const { llave, efimera } = llaveParaCifrar(publicaAdmin);
    const iv = randomBytes(12);
    const archivo = await open(ruta, 'wx', 0o600);
    const cabecera = Buffer.concat([MAGIA_V2, sal, efimera, iv, Buffer.alloc(16)]);
    await archivo.write(cabecera);
    const cifrador = createCipheriv('aes-256-gcm', llave, iv);
    llave.fill(0);
    return new EscritorCifrado(archivo, cifrador, cabecera.length);
  }

  async escribir(texto: string): Promise<void> {
    const cifrado = this.cifrador.update(texto, 'utf8');
    if (cifrado.length) {
      await this.archivo.write(cifrado);
      this.bytes += cifrado.length;
    }
  }

  /** Cierra el cifrado, escribe el tag y devuelve el tamaño final. */
  async cerrar(): Promise<number> {
    const final = this.cifrador.final();
    if (final.length) await this.archivo.write(final);
    await this.archivo.write(this.cifrador.getAuthTag(), 0, 16, POS_TAG_V2);
    await this.archivo.close();
    return this.bytes + final.length;
  }

  async descartar(): Promise<void> {
    await this.archivo.close().catch(() => undefined);
  }
}

function sha256(ruta: string): Promise<string> {
  return new Promise((ok, mal) => {
    const h = createHash('sha256');
    createReadStream(ruta)
      .on('data', (c) => h.update(c))
      .on('end', () => ok(h.digest('hex')))
      .on('error', mal);
  });
}

const formatoFecha = (d: Date) => d.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' });

function aVista(
  f: {
    id: string;
    solicitadaPorId: string;
    estado: ExportacionCentroVista['estado'];
    tablasTotal: number;
    tablasHechas: number;
    fichasTotal: number;
    fichasHechas: number;
    bytes: bigint | null;
    huella: string | null;
    motivoFallo: string | null;
    creadaEn: Date;
    terminadaEn: Date | null;
    venceEn: Date | null;
    descargadaEn: Date | null;
    programadaPara: Date;
    urgente: boolean;
    intentos: number;
  },
  yo: string,
): ExportacionCentroVista {
  return {
    id: f.id,
    estado: f.estado,
    propia: f.solicitadaPorId === yo,
    tablasTotal: f.tablasTotal,
    tablasHechas: f.tablasHechas,
    fichasTotal: f.fichasTotal,
    fichasHechas: f.fichasHechas,
    bytes: f.bytes === null ? null : Number(f.bytes),
    huella: f.huella,
    motivoFallo: f.motivoFallo,
    creadaEn: f.creadaEn,
    terminadaEn: f.terminadaEn,
    venceEn: f.venceEn,
    descargadaEn: f.descargadaEn,
    programadaPara: f.programadaPara,
    urgente: f.urgente,
    intentos: f.intentos,
  };
}
