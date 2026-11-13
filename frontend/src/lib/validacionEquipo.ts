'use client';

/**
 * Validacion de cada integrante (diseño "Equipo del centro, version 1":
 * ficha del integrante con lista de validacion). Se arma con lo que la API
 * ya entrega; no hay un estado "habilitado" guardado en la BD:
 *
 * - Profesional: registro SIS (RNPI) verificado y al menos un titulo
 *   verificado (exige respaldo) BLOQUEAN: sin ellos no aparece en el sitio
 *   (profesional_validado() en la BD, 2026-11-08). Tipos de atencion y
 *   especialidades por revisar son un pendiente, no bloquean.
 * - Practicante: supervisor vigente, practica en curso y acceso vigente
 *   bloquean; los documentos de la practica son del perfil y no bloquean.
 * - Cuenta madre o gestion sin rol profesional: no requiere validacion.
 */
import { useQueries } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';
import type { Rol } from './sesion';

type S = components['schemas'];
type RegistroSis = S['RegistroSisVista'];

export type EstadoIntegrante = 'HABILITADO' | 'POR_VALIDAR' | 'VENCIDO' | 'BAJA' | 'NO_REQUIERE' | 'INACTIVA';

export const ESTADO_INTEGRANTE: Record<EstadoIntegrante, { chip: string; texto: string; tono: 'positivo' | 'atencion' | 'neutro' }> = {
  HABILITADO: { chip: 'Habilitado', texto: 'Habilitado para atender', tono: 'positivo' },
  POR_VALIDAR: { chip: 'Por validar', texto: 'Por validar: no aparece en el sitio hasta que la cuenta madre lo valide', tono: 'atencion' },
  VENCIDO: { chip: 'Vencido', texto: 'Sin acceso: su acceso de práctica venció', tono: 'atencion' },
  BAJA: { chip: 'Baja', texto: 'Baja programada', tono: 'neutro' },
  NO_REQUIERE: { chip: 'No requiere', texto: 'Rol administrativo: no requiere validación profesional', tono: 'neutro' },
  INACTIVA: { chip: 'Inactiva', texto: 'Cuenta desactivada', tono: 'neutro' },
};

export type ClaveCheck = 'sis' | 'titulo' | 'tipos' | 'supervisor' | 'practica' | 'acceso' | 'documentos';

export interface Check {
  clave: ClaveCheck;
  titulo: string;
  ok: boolean;
  detalle: string;
  /** Si falta, el integrante queda "Por validar" (o "Vencido"). Los demas son pendientes informativos. */
  bloquea: boolean;
}

export interface DatosValidacion {
  roles: readonly Rol[];
  activo: boolean;
  /** Fecha efectiva de una baja aun no procesada (cuenta o rol profesional). */
  bajaEn?: string | null;
  registro?: RegistroSis;
  trayectoria?: S['TrayectoriaVista'][];
  tipos?: S['TipoAtencionProfesionalVista'][];
  especialidades?: S['EspecialidadDeclaradaVista'][];
  /** Practicante: supervisor vigente (nombre) o null. */
  supervisor?: string | null;
  practica?: { inicio: string; termino: string } | null;
  /** Practicante: vencimiento del acceso (solo ADMIN lo ve; undefined = no se sabe). */
  accesoHasta?: string | null;
  /** Practicante: tipos de documento ya subidos (undefined = no se sabe). */
  documentos?: string[];
  ahora: number;
}

const VERIFICADO: RegistroSis['estado'][] = ['VERIFICADO_AUTOMATICO', 'VERIFICADO_MANUAL'];
const DETALLE_SIS: Record<RegistroSis['estado'], string> = {
  NO_INFORMADO: 'Todavía no informa su número',
  PENDIENTE: 'aún no se verifica',
  VERIFICADO_AUTOMATICO: 'verificado en la Superintendencia',
  VERIFICADO_MANUAL: 'verificado por el centro',
  NO_COINCIDE: 'no coincide con el buscador del RNPI',
};

/** Lista de validacion; undefined mientras falten datos. Vacia = no requiere. */
export function checksIntegrante(d: DatosValidacion): Check[] | undefined {
  // Fechas de calendario (practica y acceso): se leen como dia, sin correr por la zona horaria.
  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-CL', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  if (d.roles.includes('PROFESIONAL')) {
    if (!d.registro || !d.trayectoria || !d.tipos || !d.especialidades) return undefined;
    const r = d.registro;
    const titulos = d.trayectoria.filter((t) => t.tipo === 'TITULO');
    const verificado = titulos.find((t) => t.verificado);
    const tiposPend = d.tipos.filter((t) => t.estado === 'PROPUESTO').length + d.especialidades.filter((e) => e.estado === 'PROPUESTO').length;
    return [
      {
        clave: 'sis',
        titulo: 'Registro en la Superintendencia (RNPI)',
        ok: VERIFICADO.includes(r.estado),
        bloquea: true,
        detalle: r.numero ? `N.° ${r.numero} · ${DETALLE_SIS[r.estado]}` : DETALLE_SIS[r.estado],
      },
      {
        clave: 'titulo',
        titulo: 'Título habilitante',
        ok: !!verificado,
        bloquea: true,
        detalle: verificado
          ? `${verificado.titulo} · ${verificado.institucion} · respaldo revisado`
          : titulos.length
            ? `${titulos.length === 1 ? 'Un título' : `${titulos.length} títulos`} por revisar`
            : 'Todavía no agrega su título',
      },
      {
        clave: 'tipos',
        titulo: 'Tipos de atención y especialidades',
        ok: tiposPend === 0,
        bloquea: false,
        detalle: tiposPend ? `${tiposPend} por revisar` : d.tipos.length ? 'Todo lo declarado está revisado' : 'Sin tipos declarados',
      },
    ];
  }
  if (d.roles.includes('PRACTICANTE')) {
    if (d.supervisor === undefined || d.practica === undefined) return undefined;
    const enCurso =
      d.practica && new Date(d.practica.inicio).getTime() <= d.ahora && d.ahora <= new Date(`${d.practica.termino.slice(0, 10)}T23:59:59`).getTime();
    const checks: Check[] = [
      { clave: 'supervisor', titulo: 'Supervisor asignado', ok: !!d.supervisor, bloquea: true, detalle: d.supervisor ?? 'Sin supervisor: no puede atender' },
      {
        clave: 'practica',
        titulo: 'Práctica',
        ok: !!enCurso,
        bloquea: true,
        detalle: d.practica ? `Del ${fecha(d.practica.inicio)} al ${fecha(d.practica.termino)}` : 'Sin práctica registrada',
      },
    ];
    if (d.accesoHasta !== undefined) {
      const vigente = !!d.accesoHasta && d.activo && new Date(d.accesoHasta).getTime() > d.ahora;
      checks.push({
        clave: 'acceso',
        titulo: 'Acceso a la plataforma',
        ok: vigente,
        bloquea: true,
        detalle: vigente ? `Hasta el ${fecha(d.accesoHasta!)}` : d.accesoHasta ? `Venció el ${fecha(d.accesoHasta)}` : 'Sin acceso otorgado',
      });
    }
    if (d.documentos !== undefined) {
      const faltan = [
        !d.documentos.includes('CERTIFICADO_ALUMNO_REGULAR') && 'certificado de alumno regular',
        !d.documentos.includes('CONVENIO_PRACTICA') && 'convenio de práctica',
      ].filter(Boolean);
      checks.push({
        clave: 'documentos',
        titulo: 'Documentos de la práctica',
        ok: faltan.length === 0,
        bloquea: false,
        detalle: faltan.length ? `Falta: ${faltan.join(' y ')}` : 'Certificado de alumno regular y convenio de práctica',
      });
    }
    return checks;
  }
  return [];
}

export function estadoIntegrante(d: DatosValidacion, checks: Check[] | undefined): EstadoIntegrante | undefined {
  if (!d.activo && !d.roles.includes('PRACTICANTE')) return 'INACTIVA';
  if (d.bajaEn) return 'BAJA';
  if (!checks) return undefined;
  if (checks.length === 0) return 'NO_REQUIERE';
  if (checks.some((c) => c.clave === 'acceso' && !c.ok)) return 'VENCIDO';
  return checks.every((c) => c.ok || !c.bloquea) ? 'HABILITADO' : 'POR_VALIDAR';
}

/**
 * Datos de validacion de varios profesionales a la vez (lista del equipo).
 * Mismas claves de cache que las fichas, asi que abrir una no repite pedidos.
 * ponytail: 4 pedidos por profesional; con equipos grandes (>30) conviene un
 * endpoint agregado en la API.
 */
export function useDatosProfesionales(ids: string[]) {
  const pedir = <T>(clave: string, fn: (id: string) => Promise<T>) =>
    ids.map((id) => ({ queryKey: ['equipo', clave, id], queryFn: () => fn(id), staleTime: 60_000 }));
  const con = (id: string) => ({ params: { path: { id } } });
  return useQueries({
    queries: [
      ...pedir('registro-sis', (id) => datos(api.GET('/api/profesionales/{id}/registro-sis', con(id)))),
      ...pedir('trayectoria', (id) => datos(api.GET('/api/profesionales/{id}/trayectoria', con(id)))),
      ...pedir('tipos', (id) => datos(api.GET('/api/profesionales/{id}/tipos-atencion', con(id)))),
      ...pedir('especialidades', (id) => datos(api.GET('/api/profesionales/{id}/especialidades', con(id)))),
    ],
    combine: (r) => {
      const n = ids.length;
      return new Map(
        ids.map((id, i) => [
          id,
          {
            registro: r[i]?.data as RegistroSis | undefined,
            trayectoria: r[n + i]?.data as S['TrayectoriaVista'][] | undefined,
            tipos: r[2 * n + i]?.data as S['TipoAtencionProfesionalVista'][] | undefined,
            especialidades: r[3 * n + i]?.data as S['EspecialidadDeclaradaVista'][] | undefined,
          },
        ]),
      );
    },
  });
}

/** Tipos de documento subidos por cada practicante (misma clave que la ficha). */
export function useTiposDocumentoPracticantes(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['equipo', 'documentos-practicante', id],
      queryFn: () => datos(api.GET('/api/practicantes/{id}/documentos', { params: { path: { id } } })),
      staleTime: 60_000,
    })),
    combine: (r) => new Map(ids.map((id, i) => [id, r[i]?.data?.map((d) => d.tipo as string)])),
  });
}

/** Avisos del perfil publico para la cuenta madre (heuristicas, no bloquean nada). */
export function alertasPerfil(p: Pick<S['PerfilProfesionalVista'], 'bio' | 'citaDestacada' | 'enfoques' | 'fotoUrl'>): string[] {
  const textos = `${p.bio ?? ''}\n${p.citaDestacada ?? ''}`;
  const alertas: string[] = [];
  if (/(\+?56[\s-]?)?9[\s-]?\d{4}[\s-]?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+|whats\s?app|wa\.me|instagram|@\w{3,}/i.test(textos))
    alertas.push('El texto incluye un dato de contacto personal');
  if (!p.bio || p.bio.trim().length < 160) alertas.push('"Sobre mí" muy corto: menos de 3 líneas');
  if (!p.citaDestacada?.trim()) alertas.push('Sin frase destacada');
  if (p.enfoques.length === 0) alertas.push('Sin enfoques declarados');
  if (!p.fotoUrl) alertas.push('Sin foto');
  return alertas;
}
