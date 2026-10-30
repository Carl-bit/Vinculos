import { Logger } from '@nestjs/common';

import type { Tx } from '../bd/contexto-bd.service';
import type { LlaveroService } from '../crypto/llavero.service';

/**
 * Verificacion del registro de prestadores individuales de la Superintendencia
 * de Salud (RNPI, 03b-4.2; docs/api/integraciones.md). Los modulos y el job
 * solo conocen la interfaz; CoreModule elige SUPERSALUD si hay apikey y si no
 * SIMULADO. La consulta sale solo desde el servidor.
 */
export interface ConsultaPrestador {
  registro: string;
  /** RUT sin digito verificador (solo lo usa el simulado para responder coherente). */
  rut: string | null;
  nombre: string | null;
  profesion: string | null;
}

/** Lo minimo que se lee de la respuesta (nunca fecha de nacimiento, sexo ni nacionalidad). */
export interface PrestadorRnpi {
  registro: string;
  /** Sin digito verificador. */
  rut: string | null;
  nombre: string | null;
  titulos: { titulo: string; institucion: string | null }[];
}

export type MotivoErrorVerificador = 'APIKEY' | 'LIMITE' | 'NO_DISPONIBLE';

export class ErrorVerificador extends Error {
  constructor(
    readonly motivo: MotivoErrorVerificador,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export abstract class VerificadorPrestadores {
  /** true = no consulta el RNPI (desarrollo, demo, tests o sin apikey). */
  abstract readonly simulado: boolean;
  /** null = el registro no existe en el RNPI (404). */
  abstract buscar(consulta: ConsultaPrestador): Promise<PrestadorRnpi | null>;
}

/**
 * Simulado: responde coherente con lo consultado, salvo dos prefijos para
 * probar los otros caminos: registro que empieza con 9 = no existe; con 8 =
 * pertenece a otro RUT (no coincide).
 */
export class VerificadorSimulado extends VerificadorPrestadores {
  readonly simulado = true;

  async buscar(c: ConsultaPrestador): Promise<PrestadorRnpi | null> {
    if (c.registro.startsWith('9')) return null;
    return {
      registro: c.registro,
      rut: c.registro.startsWith('8') ? '1' : c.rut,
      nombre: c.nombre,
      titulos: [{ titulo: c.profesion ?? 'Psicólogo', institucion: 'Universidad de demostración' }],
    };
  }
}

/** Tolerante al formato: la documentacion se entrega con la apikey; se ajusta aqui al recibirla. */
const primero = (v: unknown): unknown => (Array.isArray(v) ? (v as unknown[])[0] : v);

/** Primer campo de texto (o numero) entre las claves dadas. */
const lector =
  (o: Record<string, unknown>) =>
  (...claves: string[]): string | null => {
    for (const k of claves) {
      const v = o[k];
      if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
    }
    return null;
  };

export function parsearPrestador(cuerpo: unknown): PrestadorRnpi | null {
  const raiz = primero(cuerpo);
  const dato = primero(raiz && typeof raiz === 'object' && 'data' in raiz ? raiz.data : raiz);
  if (!dato || typeof dato !== 'object') return null;
  const o = dato as Record<string, unknown>;
  const txt = lector(o);
  const rut = txt('rut', 'run', 'rutPrestador');
  const nombre =
    txt('nombreCompleto', 'nombre_completo', 'nombre') ??
    ([txt('nombres'), txt('apellidoPaterno', 'apellido_paterno'), txt('apellidoMaterno', 'apellido_materno')].filter(Boolean).join(' ') || null);
  const lista = o.titulos ?? o.antecedentes ?? o.titulosHabilitantes;
  const titulos = (Array.isArray(lista) ? (lista as unknown[]) : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => {
      const l = lector(t);
      return { titulo: l('titulo', 'nombre', 'glosa', 'descripcion') ?? '', institucion: l('institucion', 'universidad', 'procedencia') };
    })
    .filter((t) => t.titulo);
  const unico = txt('titulo', 'tituloHabilitante');
  if (unico && titulos.length === 0) titulos.push({ titulo: unico, institucion: txt('institucion', 'universidad') });
  return { registro: txt('registro', 'numeroRegistro', 'nroRegistro') ?? '', rut: rut ? rutSinDv(rut) : null, nombre, titulos };
}

/**
 * Adaptador real: API de prestadores de la Superintendencia
 * (/api/v2/prestadores/registro/{registro}) con la apikey del convenio.
 * Timeout de 5 s y hasta 2 reintentos (cabe en los 20 s de la transaccion) ante red caida o 5xx; 404 = no existe;
 * 401/403 = apikey; 429 = limite (sin reintento).
 */
export class VerificadorSuperSalud extends VerificadorPrestadores {
  readonly simulado = false;

  constructor(
    private readonly apikey: string,
    private readonly urlBase: string,
    private readonly http: typeof fetch = fetch,
    private readonly reintentos = 2,
  ) {
    super();
  }

  async buscar(c: ConsultaPrestador): Promise<PrestadorRnpi | null> {
    const url = `${this.urlBase.replace(/\/$/, '')}/api/v2/prestadores/registro/${encodeURIComponent(c.registro)}`;
    for (let intento = 0; ; intento++) {
      let r: Response;
      try {
        r = await this.http(url, { headers: { apikey: this.apikey, accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      } catch {
        if (intento < this.reintentos) continue;
        throw new ErrorVerificador('NO_DISPONIBLE', 'El registro de prestadores no responde');
      }
      if (r.status === 404) return null;
      if (r.status === 401 || r.status === 403) throw new ErrorVerificador('APIKEY', 'La apikey de la Superintendencia no es valida o no tiene permiso');
      if (r.status === 429) throw new ErrorVerificador('LIMITE', 'Se alcanzo el limite de consultas a la Superintendencia');
      if (r.status >= 500 && intento < this.reintentos) continue;
      if (!r.ok) throw new ErrorVerificador('NO_DISPONIBLE', `El registro de prestadores respondio ${r.status}`);
      return parsearPrestador(await r.json());
    }
  }
}

/** RUT del RNPI sin digito verificador: con guion se corta ahi; sin guion ya viene sin DV (asi lo usa la API). */
export const rutSinDv = (rut: string) => (rut.includes('-') ? rut.split('-')[0] : rut).replace(/[^0-9]/g, '');

const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 1);

/** Todas las palabras del nombre interno estan en el nombre del RNPI (que suele traer ambos apellidos). */
const mismoNombre = (interno: string, rnpi: string) => {
  const r = new Set(normal(rnpi));
  const i = normal(interno);
  return i.length > 0 && i.every((p) => r.has(p));
};

// ponytail: raiz comun de 6 letras ("psicol" en Psicologo / Psicologia clinica); tabla de profesiones si aparecen falsos negativos.
const mismaProfesion = (titulo: string, profesion: string) => {
  const raices = new Set(
    normal(profesion)
      .filter((p) => p.length >= 6)
      .map((p) => p.slice(0, 6)),
  );
  return normal(titulo).some((p) => p.length >= 6 && raices.has(p.slice(0, 6)));
};

export type EstadoVerificacion = 'VERIFICADO_AUTOMATICO' | 'NO_COINCIDE';

export interface ResultadoVerificacion {
  estado: EstadoVerificacion;
  titulo: string | null;
  institucion: string | null;
  motivo: string | null;
}

/** Regla: el registro existe, es del RUT y del nombre del profesional, y algun titulo coincide con su profesion. */
export function evaluarVerificacion(p: PrestadorRnpi | null, c: ConsultaPrestador): ResultadoVerificacion {
  const no = (motivo: string, t?: { titulo: string; institucion: string | null }): ResultadoVerificacion => ({
    estado: 'NO_COINCIDE',
    titulo: t?.titulo ?? null,
    institucion: t?.institucion ?? null,
    motivo,
  });
  if (!p) return no('El número no existe en el registro de prestadores');
  if (!c.rut || !p.rut || p.rut !== c.rut) return no('El registro pertenece a otro RUT', p.titulos[0]);
  if (!c.nombre || !p.nombre || !mismoNombre(c.nombre, p.nombre)) return no('El nombre no coincide', p.titulos[0]);
  const titulo = c.profesion ? p.titulos.find((t) => mismaProfesion(t.titulo, c.profesion!)) : undefined;
  if (!titulo) return no('El título habilitante no coincide con la profesión', p.titulos[0]);
  return { estado: 'VERIFICADO_AUTOMATICO', titulo: titulo.titulo, institucion: titulo.institucion, motivo: null };
}

export class SinRutParaVerificar extends Error {}

/**
 * Verifica contra el RNPI los registros de un profesional (o todos, NULL:
 * solo el job) y guarda el resultado con registrar_verificacion_sis(). Corre
 * en la transaccion del llamador (RLS del actor, o sin contexto en el job).
 * Sin RUT en datos privados no se puede comparar: queda PENDIENTE.
 */
export async function verificarRegistrosSis(
  tx: Tx,
  llavero: LlaveroService,
  verificador: VerificadorPrestadores,
  profesionalId: string | null,
  logger?: Logger,
): Promise<{ total: number; resultados: (ResultadoVerificacion & { profesionalId: string })[] }> {
  const filas = await tx.$queryRaw<{ profesional_id: string; numero: string; nombre: string | null; especialidad: string | null; rut: Uint8Array | null }[]>`
    SELECT profesional_id, numero, nombre, especialidad, rut FROM datos_verificacion_sis(${profesionalId}::uuid)`;
  const resultados: (ResultadoVerificacion & { profesionalId: string })[] = [];
  for (const f of filas) {
    // Interno normalizado (normalizarRut): cuerpo + DV sin separadores.
    const rut = f.rut ? (llavero.descifrarCampo(f.rut, 'profesional_datos_privados', 'rut', f.profesional_id) ?? '').slice(0, -1) || null : null;
    if (!rut) {
      if (profesionalId) throw new SinRutParaVerificar();
      logger?.warn(`registro SIS sin RUT para verificar (profesional ${f.profesional_id})`);
      continue;
    }
    const consulta = { registro: f.numero, rut, nombre: f.nombre, profesion: f.especialidad };
    const r = evaluarVerificacion(await verificador.buscar(consulta), consulta);
    await tx.$executeRaw`SELECT registrar_verificacion_sis(${f.profesional_id}::uuid, ${f.numero}, ${r.estado}, 'AUTOMATICO', ${r.titulo}, ${r.institucion})`;
    resultados.push({ ...r, profesionalId: f.profesional_id });
  }
  return { total: resultados.length, resultados };
}
