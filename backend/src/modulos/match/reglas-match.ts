/**
 * Calculo del match por reglas (D-5, sin IA) y explicable: cada opcion del
 * cuestionario aplica un criterio sobre el perfil publico con un peso; las
 * estrictas filtran (si nadie las cumple, se ofrece al mas cercano con una
 * advertencia que dice que no cumple). Funciones puras: se prueban sin BD.
 */
import type { CriterioMatch } from '@prisma/client';

export interface OpcionMatch {
  valor: string;
  etiqueta: string;
  criterio: CriterioMatch | null;
  objetivo: string | null;
  peso: number;
  estricto: boolean;
  mensaje: string | null;
}

export interface PreguntaMatch {
  clave: string;
  texto: string;
  tipo: 'UNICA' | 'MULTIPLE' | 'ESCALA' | 'TEXTO' | 'DIAS' | 'FRANJAS';
  obligatoria: boolean;
  max_selecciones: number | null;
  opciones: OpcionMatch[];
}

export interface PerfilParaMatch {
  id: string;
  nombre_publico: string | null;
  especialidad: string;
  enfoques: string[];
  modalidad: 'PRESENCIAL' | 'ONLINE' | 'MIXTA';
  tipos_atencion: string[];
  boleta_reembolsable: boolean;
  convenios: string[];
}

export type Respuestas = Record<string, string | string[]>;

export interface Evaluacion {
  perfilId: string;
  puntaje: number;
  razones: string[];
  /** Criterios estrictos que no cumple (advertencia explicable). */
  incumple: string[];
}

/** Sin mayusculas ni tildes, para comparar textos del perfil con el objetivo. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const contiene = (lista: string[], objetivo: string) => lista.some((x) => normalizar(x).includes(normalizar(objetivo)));

/** Si el perfil cumple el criterio de una opcion, con la razon en lenguaje claro. */
export function cumple(op: OpcionMatch, p: PerfilParaMatch): string | null {
  const o = op.objetivo ?? '';
  switch (op.criterio) {
    case 'TIPO_ATENCION':
      return contiene(p.tipos_atencion, o) ? `atiende ${o.toLowerCase()}` : null;
    case 'ENFOQUE':
      return contiene(p.enfoques, o) || contiene([p.especialidad], o) ? `trabaja ${op.etiqueta.toLowerCase()}` : null;
    case 'ESPECIALIDAD':
      return contiene([p.especialidad], o) ? `es ${p.especialidad.toLowerCase()}` : null;
    case 'MODALIDAD':
      return p.modalidad === 'MIXTA' || p.modalidad === o ? `atiende ${o === 'ONLINE' ? 'online' : 'presencial'}` : null;
    case 'PRESUPUESTO':
      // No puntua: ordena por tramos de precio (tramoPrecio).
      return null;
    case 'PREVISION':
      if (normalizar(o) === 'fonasa') {
        return contiene(p.convenios, 'fonasa') ? 'tiene convenio FONASA' : null;
      }
      return p.boleta_reembolsable || contiene(p.convenios, 'isapre') ? 'emite boleta reembolsable en isapre' : null;
    default:
      return null;
  }
}

/** Opciones elegidas (por valor) de las preguntas con opciones. */
export function opcionesElegidas(preguntas: PreguntaMatch[], respuestas: Respuestas): OpcionMatch[] {
  return preguntas.flatMap((q) => {
    const r = respuestas[q.clave];
    const valores = Array.isArray(r) ? r : r === undefined ? [] : [r];
    return q.opciones.filter((o) => valores.includes(o.valor));
  });
}

/** Valida respuestas contra el cuestionario: obligatorias, opciones existentes, maximo y largo del texto. */
export function validarRespuestas(preguntas: PreguntaMatch[], respuestas: Respuestas): string[] {
  const errores: string[] = [];
  for (const q of preguntas) {
    const r = respuestas[q.clave];
    const vacia = r === undefined || (Array.isArray(r) ? r.length === 0 : String(r).trim() === '');
    if (vacia) {
      if (q.obligatoria) errores.push(`${q.clave}: obligatoria`);
      continue;
    }
    if (q.tipo === 'TEXTO') {
      const t = Array.isArray(r) ? r.join(' ') : r;
      if (t.trim().length < 10 || t.length > 4000) errores.push(`${q.clave}: entre 10 y 4000 caracteres`);
      continue;
    }
    const valores = Array.isArray(r) ? r : [r];
    if (valores.some((v) => !q.opciones.some((o) => o.valor === v))) errores.push(`${q.clave}: opcion inexistente`);
    const max = q.tipo === 'MULTIPLE' || q.tipo === 'DIAS' || q.tipo === 'FRANJAS' ? (q.max_selecciones ?? Infinity) : 1;
    if (valores.length > max) errores.push(`${q.clave}: maximo ${max === Infinity ? 'sin limite' : max}`);
  }
  for (const clave of Object.keys(respuestas)) {
    if (!preguntas.some((q) => q.clave === clave)) errores.push(`${clave}: pregunta inexistente o inactiva`);
  }
  return errores;
}

export function evaluar(perfiles: PerfilParaMatch[], elegidas: OpcionMatch[]): Evaluacion[] {
  return perfiles.map((p) => {
    const razones: string[] = [];
    const incumple: string[] = [];
    let puntaje = 0;
    for (const op of elegidas.filter((o) => o.criterio)) {
      const razon = cumple(op, p);
      if (razon) {
        puntaje += op.peso;
        razones.push(razon);
      } else if (op.estricto) {
        incumple.push(op.etiqueta);
      }
    }
    return { perfilId: p.id, puntaje, razones: [...new Set(razones)], incumple };
  });
}

export interface Tramo {
  /** 0 = dentro de la preferencia; despues, cada tramo mas caro. */
  indice: number;
  titulo: string;
}

const clp = (n: number) => `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/**
 * Tramo de precio de una tarifa respecto de la preferencia de pago (03b-4.1).
 * Los tramos siguen los topes que el centro configuro como opciones de la
 * pregunta: con preferencia "hasta $35.000" y topes 45.000 y 60.000, una
 * tarifa de 40.000 cae en "Hasta $10.000 más que tu preferencia". Sin tarifa
 * publicada, al final.
 */
export function tramoPrecio(tarifa: number | null, tope: number, topes: number[]): Tramo {
  if (tarifa === null) return { indice: Number.MAX_SAFE_INTEGER, titulo: 'Sin tarifa publicada' };
  if (tarifa <= tope) return { indice: 0, titulo: 'Dentro de tu preferencia' };
  const mayores = [...new Set(topes)].filter((t) => t > tope).sort((a, b) => a - b);
  const i = mayores.findIndex((t) => tarifa <= t);
  if (i >= 0) return { indice: i + 1, titulo: `Hasta ${clp(mayores[i] - tope)} más que tu preferencia` };
  const ultimo = mayores.at(-1);
  return { indice: mayores.length + 1, titulo: ultimo ? `Más de ${clp(ultimo - tope)} sobre tu preferencia` : 'Sobre tu preferencia' };
}

/**
 * Orden: primero quienes cumplen todo lo estricto; luego menos incumplimientos;
 * despues puntaje y, a igualdad, quien tiene hora antes.
 */
export function ordenar<T extends Evaluacion & { primerHueco: Date | null }>(evals: T[]): T[] {
  return [...evals].sort(
    (a, b) => a.incumple.length - b.incumple.length || b.puntaje - a.puntaje || (a.primerHueco?.getTime() ?? Infinity) - (b.primerHueco?.getTime() ?? Infinity),
  );
}
