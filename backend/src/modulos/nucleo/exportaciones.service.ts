import { createCipheriv, createHash, randomBytes, randomInt, randomUUID, scryptSync } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';

import { registrarExportacion } from '../../core/bd/auditoria';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { CAMPOS_CIFRADOS } from '../../common/crypto/registro';
import { hashToken, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { generarPdfDocumento } from '../../core/documentos/pdf';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import type { ExportacionPacienteVista } from './dto/nucleo.dto';

type Filas = Record<string, unknown>[];
type Tablas = Record<string, Filas | null>;

/** Version del formato de las exportaciones (cambia si cambia la forma del JSON). */
export const VERSION_EXPORTACION = 1;
/** Cabecera del archivo cifrado de la exportacion del centro (infra/scripts/exportacion/descifrar.mjs). */
const MAGIA = Buffer.from('VINCULOS-EXPORT-1\n', 'utf8');

/**
 * AUD-01 Fase 3 (docs/cumplimiento/exportacion.md).
 *
 * Paciente (ARCOP-02): ADMIN prepara la parte administrativa desde una
 * solicitud de acceso o portabilidad; si hay ficha, el tratante agrega la
 * clinica (ADMIN nunca la ve). Completa, se envia un enlace de un solo uso al
 * correo registrado (72 h) de cada destinatario segun la edad (la BD decide:
 * menor de 14 solo sus adultos responsables; 14 a 17 el paciente y sus
 * adultos; mayor, el paciente). Con cuenta, la descarga exige su sesion; sin
 * cuenta, el codigo de un segundo correo. Se descarga en JSON o PDF.
 *
 * Centro (LEG-04): ADMIN la pide con una clave que no se guarda; el archivo
 * sale cifrado (AES-256-GCM, scrypt) y solo el centro lo abre (D5).
 */
@Injectable()
export class ExportacionesService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
    private readonly config: ConfigService,
  ) {}

  // --- Paciente ---------------------------------------------------------------

  async preparar(solicitudId: string): Promise<ExportacionPacienteVista> {
    const tx = this.bd.tx();
    const s = encontrado(await tx.solicitudDerecho.findUnique({ where: { id: solicitudId }, select: { pacienteId: true } }), 'Solicitud');
    const id = randomUUID();
    const datos = await this.leerParte(s.pacienteId ?? '', 'ADMINISTRATIVA');
    const [{ clinica }] = await tx.$queryRaw<[{ clinica: boolean }]>`
      SELECT crear_exportacion_paciente(${id}::uuid, ${solicitudId}::uuid,
        ${this.llavero.cifrarCampo(JSON.stringify(datos), 'exportaciones_paciente', 'datos_administrativos', id)}) AS clinica`;
    if (!clinica) await this.enviar(id);
    return this.vista(id);
  }

  /** Pendientes del tratante (metadatos; la RLS deja ver solo las de sus pacientes). */
  async pendientesClinicas(): Promise<ExportacionPacienteVista[]> {
    const filas = await this.bd.tx().exportacionPaciente.findMany({
      where: { requiereClinica: true, clinicaEn: null, purgadaEn: null },
      select: { id: true },
      orderBy: { creadaEn: 'asc' },
    });
    return Promise.all(filas.map((f) => this.vista(f.id)));
  }

  async agregarClinica(id: string): Promise<ExportacionPacienteVista> {
    const e = encontrado(await this.bd.tx().exportacionPaciente.findUnique({ where: { id }, select: { pacienteId: true } }), 'Exportacion');
    const datos = await this.leerParte(e.pacienteId, 'CLINICA');
    await this.bd.tx().$executeRaw`
      SELECT agregar_clinica_exportacion(${id}::uuid,
        ${this.llavero.cifrarCampo(JSON.stringify(datos), 'exportaciones_paciente', 'datos_clinicos', id)})`;
    await this.enviar(id);
    return this.vista(id);
  }

  async vista(id: string): Promise<ExportacionPacienteVista> {
    const e = encontrado(
      await this.bd.tx().exportacionPaciente.findUnique({
        where: { id },
        select: {
          id: true,
          pacienteId: true,
          solicitudId: true,
          requiereClinica: true,
          creadaEn: true,
          clinicaEn: true,
          enviadaEn: true,
          venceEn: true,
          descargas: true,
          purgadaEn: true,
          destinatarios: { select: { adultoResponsableId: true, descargas: true }, orderBy: { id: 'asc' } },
        },
      }),
      'Exportacion',
    );
    const estado = e.purgadaEn ? 'VENCIDA' : e.enviadaEn ? 'ENVIADA' : e.requiereClinica && !e.clinicaEn ? 'ESPERANDO_TRATANTE' : 'LISTA';
    const destinatarios = e.destinatarios
      .map((d) => ({ adultoResponsable: d.adultoResponsableId !== null, descargas: d.descargas }))
      .sort((a, b) => Number(a.adultoResponsable) - Number(b.adultoResponsable));
    return { ...e, estado, destinatarios };
  }

  /** Completa: un enlace por destinatario y, sin cuenta, el codigo en un segundo correo. */
  private async enviar(id: string) {
    const tx = this.bd.tx();
    const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT destinatarios_pendientes_exportacion(${id}::uuid) AS n`;
    const enlaces = Array.from({ length: n }, () => ({ ...nuevoTokenCorreo(), codigo: String(randomInt(10_000_000, 100_000_000)) }));
    const destinatarios = await tx.$queryRaw<{ correo: string; con_cuenta: boolean; es_adulto: boolean }[]>`
      SELECT * FROM enviar_exportacion(${id}::uuid, ${enlaces.map((e) => e.hash)}::bytea[], ${enlaces.map((e) => hashToken(e.codigo))}::bytea[])`;
    const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    this.bd.alConfirmar(async () => {
      for (const [i, d] of destinatarios.entries()) {
        const { token, codigo } = enlaces[i];
        // Con cuenta, el enlace va al portal (exige su sesion); sin cuenta, a la pagina publica con codigo.
        const enlace = `${base}${d.con_cuenta ? '/portal' : ''}/exportacion?token=${token}`;
        await this.correos.enviarAviso(
          d.correo,
          d.es_adulto ? 'Los datos personales de la persona a tu cargo estan listos' : 'Tus datos personales estan listos',
          (d.es_adulto
            ? 'El centro preparo la copia de los datos personales de la persona que tienes a cargo. '
            : 'El centro preparo la copia de tus datos que pediste. ') +
            `Puedes descargarla una o mas veces durante 72 horas:\n\n${enlace}\n\n` +
            (d.con_cuenta ? 'Te pediremos iniciar sesion con tu cuenta.' : 'Te pediremos el codigo que llega en un correo aparte.') +
            ' No compartas este enlace.',
        );
        if (!d.con_cuenta) {
          await this.correos.enviarAviso(
            d.correo,
            d.es_adulto ? 'Codigo para descargar los datos de la persona a tu cargo' : 'Codigo para descargar tus datos',
            `Tu codigo es: ${codigo}\n\nUsalo junto con el enlace del otro correo. Vence en 72 horas.`,
          );
        }
      }
    });
  }

  /** Descarga (portal con sesion, o publica con codigo). Devuelve el archivo en el formato pedido. */
  async descargar(token: string, codigo: string | null, formato: 'json' | 'pdf', conSesion: boolean) {
    const db = conSesion ? this.bd.tx() : this.bd.sinContexto('publico');
    const [e] = await db.$queryRaw<{ id: string; datos_administrativos: Uint8Array; datos_clinicos: Uint8Array | null }[]>`
      SELECT * FROM entregar_exportacion(${hashToken(token)}, ${codigo ? hashToken(codigo) : null})`;
    const admin = JSON.parse(this.llavero.descifrarCampo(e.datos_administrativos, 'exportaciones_paciente', 'datos_administrativos', e.id)!) as Tablas;
    const clinica = e.datos_clinicos
      ? (JSON.parse(this.llavero.descifrarCampo(e.datos_clinicos, 'exportaciones_paciente', 'datos_clinicos', e.id)!) as Tablas)
      : {};
    const documento = {
      formato: 'vinculos-exportacion-paciente',
      version: VERSION_EXPORTACION,
      generadoEn: new Date().toISOString(),
      centro: await this.nombreCentro(db),
      datos: { ...admin, ...clinica },
    };
    if (formato === 'json') {
      return { contenido: Buffer.from(JSON.stringify(documento, null, 2), 'utf8'), tipo: 'application/json', nombre: 'mis-datos.json' };
    }
    const pdf = await generarPdfDocumento({
      centro: documento.centro,
      titulo: 'Copia de tus datos personales',
      texto: textoLegible(documento.datos),
      emitidoEn: new Date(),
    });
    return { contenido: pdf, tipo: 'application/pdf', nombre: 'mis-datos.pdf' };
  }

  /** Lee una parte (la BD decide quien puede) y descifra las columnas de registro.ts. */
  private async leerParte(pacienteId: string, parte: 'ADMINISTRATIVA' | 'CLINICA'): Promise<Tablas> {
    const [{ datos }] = await this.bd.tx().$queryRaw<[{ datos: Tablas }]>`
      SELECT exportar_datos_paciente(${pacienteId}::uuid, ${parte}) AS datos`;
    return this.descifrar(datos);
  }

  // --- Centro -----------------------------------------------------------------

  /**
   * Exportacion completa del centro, cifrada con la clave del ADMIN (no se
   * guarda: ni la clave ni el archivo). Registro con huella y tamaño.
   */
  async exportarCentro(clave: string): Promise<{ contenido: Buffer; nombre: string }> {
    const tx = this.bd.tx();
    const tablas = await tx.$queryRaw<{ t: string }[]>`SELECT t FROM tablas_exportacion_centro() AS t`;
    const datos: Tablas = {};
    for (const { t } of tablas) {
      const [{ filas }] = await tx.$queryRaw<[{ filas: Filas }]>`SELECT exportar_tabla_centro(${t}) AS filas`;
      datos[t] = filas;
    }
    const legibles = this.descifrar(datos);
    const fichas: Record<string, string> = {};
    const centro = await this.nombreCentro(tx);
    for (const p of (legibles.pacientes ?? []) as { id: string }[]) {
      const ficha = filtrarPaciente(legibles, p.id);
      if ((ficha.evoluciones ?? []).length || (ficha.ingresos_ficha ?? []).length) {
        const pdf = await generarPdfDocumento({ centro, titulo: 'Ficha clinica', texto: textoLegible(ficha), emitidoEn: new Date() });
        fichas[p.id] = pdf.toString('base64');
      }
    }
    const plano = Buffer.from(
      JSON.stringify({
        formato: 'vinculos-exportacion-centro',
        version: VERSION_EXPORTACION,
        generadoEn: new Date().toISOString(),
        centro,
        datos: legibles,
        fichasPdf: fichas,
      }),
      'utf8',
    );
    const sal = randomBytes(16);
    const iv = randomBytes(12);
    const llave = scryptSync(clave, sal, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cifrador = createCipheriv('aes-256-gcm', llave, iv);
    const cuerpo = Buffer.concat([cifrador.update(plano), cifrador.final()]);
    const contenido = Buffer.concat([MAGIA, sal, iv, cifrador.getAuthTag(), cuerpo]);
    const huella = createHash('sha256').update(contenido).digest('hex');
    await registrarExportacion(tx, this.bd.usuario(), {
      recurso: 'exportacion_centro',
      detalle: `${tablas.length} tablas, ${contenido.length} bytes, sha256 ${huella}`,
    });
    const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
    return { contenido, nombre: `exportacion-centro-${fecha}.vxp` };
  }

  // --- Comun ------------------------------------------------------------------

  /** Columnas cifradas (bytea como "\\x..." en el JSON) -> texto, con el AAD de su fila. */
  private descifrar(datos: Tablas): Tablas {
    const salida: Tablas = {};
    for (const [tabla, filas] of Object.entries(datos ?? {})) {
      const campos = CAMPOS_CIFRADOS.filter((c) => c.tabla === tabla);
      salida[tabla] = (filas ?? []).map((fila) => {
        const copia = { ...fila };
        for (const c of campos) {
          const v = copia[c.columna];
          if (typeof v === 'string' && v.startsWith('\\x')) {
            copia[c.columna] = this.llavero.descifrarCampo(Buffer.from(v.slice(2), 'hex'), tabla, c.columna, String(fila[c.id]));
          }
        }
        return copia;
      });
    }
    return salida;
  }

  private async nombreCentro(db: Pick<PrismaClient, '$queryRaw'>): Promise<string> {
    const [f] = await db.$queryRaw<{ c: { nombre_centro: string } }[]>`SELECT contenido_publico_centro() AS c`;
    return f?.c.nombre_centro ?? 'Centro';
  }
}

/** Las tablas del centro reducidas a un paciente (para su PDF de ficha). */
function filtrarPaciente(d: Tablas, pacienteId: string): Tablas {
  const fichas = (d.fichas_clinicas ?? []).filter((f) => f.paciente_id === pacienteId);
  const ids = new Set(fichas.map((f) => f.id));
  return {
    pacientes: (d.pacientes ?? []).filter((p) => p.id === pacienteId),
    fichas_clinicas: fichas,
    ingresos_ficha: (d.ingresos_ficha ?? []).filter((i) => ids.has(i.ficha_clinica_id)),
    evoluciones: (d.evoluciones ?? []).filter((e) => ids.has(e.ficha_clinica_id)),
  };
}

/**
 * Notas de una evolucion sin las marcas del editor (mismas que
 * frontend/src/lib/notasEvolucion.ts), para el PDF. Se limpian al exportar: lo
 * guardado no cambia (append-only) y el JSON conserva el texto tal cual. Solo
 * pares que no tocan una palabra: "2*3 y 4*5" no es una cursiva.
 */
export function notasSinMarcas(notas: string): string {
  return notas
    .replace(/^(?:#{1,2}|>) /gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(?<!\w)__([^_\n]+)__(?!\w)/g, '$1')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1');
}

/** Texto para el PDF: secciones con lo esencial de cada bloque, en lenguaje simple. */
export function textoLegible(d: Tablas): string {
  const f = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };
  const secciones: string[] = [];
  const p = (d.pacientes ?? [])[0];
  if (p) {
    secciones.push(
      [
        'DATOS PERSONALES',
        `Nombre: ${f(p.nombre)} ${f(p.apellido)}`,
        `RUT: ${f(p.rut)}`,
        `Fecha de nacimiento: ${f(p.fecha_nacimiento).slice(0, 10)}`,
        `Correo: ${f(p.email)}`,
        `Telefono: ${f(p.telefono)}`,
        `Contacto de emergencia: ${f(p.contacto_emergencia)}`,
      ].join('\n'),
    );
  }
  const lista = (titulo: string, filas: Filas | null | undefined, linea: (x: Record<string, unknown>) => string) => {
    if (filas?.length) secciones.push([titulo, ...filas.map(linea)].join('\n'));
  };
  lista('ADULTOS RESPONSABLES', d.adultos_responsables, (a) => `- ${f(a.nombre)} (${f(a.parentesco)})`);
  lista('CITAS', d.citas, (c) => `- ${f(c.inicio)} · ${f(c.modalidad)} · ${f(c.estado)}`);
  lista('PAGOS', d.pagos, (x) => `- ${f(x.fecha)} · $${f(x.monto)} · ${f(x.medio_pago)} · ${f(x.estado)}`);
  lista('COMPROBANTES DE PAGO', d.comprobantes_pago, (x) => `- ${f(x.numero)} · $${f(x.monto)}`);
  lista('DOCUMENTOS TRIBUTARIOS', d.documentos_tributarios, (x) => `- ${f(x.tipo)} folio ${f(x.folio)} · $${f(x.monto)} · ${f(x.estado)}`);
  lista('POLITICAS Y CONSENTIMIENTOS ACEPTADOS', d.aceptaciones_politica, (x) => `- ${f(x.aceptada_en)} · ${f(x.canal)}`);
  lista('SOLICITUDES SOBRE TUS DATOS', d.solicitudes_derechos, (x) => `- ${f(x.recibida_en)} · ${f(x.tipo)} · ${f(x.estado)}`);
  lista('INGRESO A LA FICHA', d.ingresos_ficha, (x) => `- ${f(x.created_at)}`);
  lista('EVOLUCIONES', d.evoluciones, (e) => `- ${f(e.created_at)} · ${f(e.autor_nombre)}\n${notasSinMarcas(f(e.notas))}`);
  lista('DOCUMENTOS CLINICOS EMITIDOS', d.documentos_clinicos, (x) => `- ${f(x.emitido_en ?? x.created_at)}`);
  lista('ADJUNTOS DE LA FICHA', d.adjuntos_ficha, (x) => `- ${f(x.nombre_archivo)} (${f(x.tipo_mime)})`);
  return secciones.join('\n\n') || 'Sin datos registrados.';
}
