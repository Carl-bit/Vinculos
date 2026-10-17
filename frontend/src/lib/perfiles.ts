/** Presentacion de los perfiles publicos (perfiles_publicos()): solo formato, sin reglas de negocio. */
import type { components } from './api/esquema';
import { formatoClp } from './formato';

type PerfilPublico = components['schemas']['PerfilPublico'];
type Modalidad = components['schemas']['Modalidad'];

export const NOMBRE_MODALIDAD: Record<Modalidad, string> = {
  MIXTA: 'Presencial y online',
  PRESENCIAL: 'Solo presencial',
  ONLINE: 'Solo online',
};

export const NOMBRE_TRAYECTORIA: Record<string, string> = {
  TITULO: 'Título',
  POSTITULO: 'Postítulo',
  DIPLOMADO: 'Diplomado',
  MAGISTER: 'Magíster',
  DOCTORADO: 'Doctorado',
  OTRO: 'Experiencia',
};

export const nombrePerfil = (p: Pick<PerfilPublico, 'nombre_publico'>) => p.nombre_publico ?? 'Profesional del centro';

/** Nombre de pila para "Pedir hora con …" (sin "Ps.", "Dr." ni similares). */
export function nombreCorto(p: Pick<PerfilPublico, 'nombre_publico'>): string {
  const palabras = nombrePerfil(p)
    .split(/\s+/)
    .filter((w) => !/^(ps|dr|dra|sr|sra|mg)\.?$/i.test(w));
  return palabras[0] ?? nombrePerfil(p);
}

/** Titulo verificado mas antiguo: "Psicólogo, Universidad X (2015)". */
export function formacionBase(p: Pick<PerfilPublico, 'trayectoria'>): string | null {
  const titulo = [...p.trayectoria].filter((t) => t.tipo === 'TITULO').sort((a, b) => a.anio - b.anio)[0];
  return titulo ? `${titulo.titulo}, ${titulo.institucion} (${titulo.anio})` : null;
}

/** Tarifa vigente mas baja, para "desde $X". */
export function tarifaDesde(p: Pick<PerfilPublico, 'tarifas'>): number | null {
  return p.tarifas.length ? Math.min(...p.tarifas.map((t) => t.monto)) : null;
}

export function textoTarifa(p: Pick<PerfilPublico, 'tarifas'>): string | null {
  const desde = tarifaDesde(p);
  if (desde === null) return null;
  const distintas = new Set(p.tarifas.map((t) => t.monto)).size > 1;
  return distintas ? `Desde ${formatoClp(desde)}` : formatoClp(desde);
}

/** "4,8" (la API entrega el promedio como texto decimal). */
export function textoCalificacion(p: Pick<PerfilPublico, 'calificacion'>): string | null {
  if (p.calificacion === null) return null;
  return Number(p.calificacion).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Tipos de atencion presentes en el equipo publicado (filtros de Equipo), en orden alfabetico. */
export const tiposDeAtencion = (perfiles: Pick<PerfilPublico, 'tipos_atencion'>[]) =>
  [...new Set(perfiles.flatMap((p) => p.tipos_atencion))].sort((a, b) => a.localeCompare(b, 'es'));

export function previsionTexto(p: Pick<PerfilPublico, 'convenios' | 'boleta_reembolsable'>): string[] {
  return [...p.convenios.map((c) => `Convenio ${c}`), ...(p.boleta_reembolsable ? ['Boleta reembolsable en isapre'] : [])];
}
