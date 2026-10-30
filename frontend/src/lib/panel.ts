'use client';

/**
 * Consultas del backoffice (03b-4). La RLS de la API decide que ve cada rol;
 * aca solo se arman las llaves y los filtros. Nombres de otros usuarios solo
 * vienen del directorio (`useProfesionales`, `useDirectorio`).
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api, datos } from './api/cliente';
import { ApiError } from './api/errores';
import type { components } from './api/esquema';

export type CitaVista = components['schemas']['CitaVista'];
export type PacienteVista = components['schemas']['PacienteVista'];
export type EspacioVista = components['schemas']['EspacioVista'];
export type ReporteDashboard = components['schemas']['ReporteDashboard'];
export type TipoAtencion = components['schemas']['TipoAtencionVista'];

const MINUTO = 60_000;

/** Reloj que avanza cada minuto: linea de la hora actual y sesion en curso. */
export function useAhora() {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), MINUTO);
    return () => clearInterval(t);
  }, []);
  return ahora;
}

export function useDashboard() {
  return useQuery({ queryKey: ['panel', 'dashboard'], queryFn: () => datos(api.GET('/api/reportes/dashboard')), refetchInterval: 5 * MINUTO });
}

/**
 * Calendario del panel (2026-10-27, estandar_polling.md): se refresca cada 2
 * minutos solo con la pestaña visible y al volver a ella.
 */
export const SONDEO_AGENDA_MS = 120_000;
const SONDEO_MAXIMO_MS = 300_000;

/**
 * Regla 3 del estandar: 429 o 5xx (o sin red) duplican el intervalo por cada
 * error hasta 5 minutos; 401/403/404 detienen el sondeo (la sesion o el
 * permiso cambiaron). Una respuesta correcta vuelve al intervalo base.
 */
export function intervaloSondeo(error: unknown, errores: number, base = SONDEO_AGENDA_MS): number | false {
  if (!error) return base;
  if (error instanceof ApiError && error.status !== 429 && error.status < 500) return false;
  return Math.min(base * 2 ** Math.max(1, errores), SONDEO_MAXIMO_MS);
}

const sondeoAgenda = {
  refetchInterval: (q: { state: { error: unknown; errorUpdateCount: number } }) => intervaloSondeo(q.state.error, q.state.errorUpdateCount),
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;

export function useCitas(
  filtro: { desde?: string; hasta?: string; profesionalId?: string; pacienteId?: string; estado?: CitaVista['estado'] },
  habilitado = true,
  opciones: { sondeo?: boolean } = {},
) {
  return useQuery({
    queryKey: ['panel', 'citas', filtro],
    queryFn: () => datos(api.GET('/api/citas', { params: { query: filtro } })),
    enabled: habilitado,
    ...(opciones.sondeo ? sondeoAgenda : {}),
  });
}

/** "Reservando..." de otras personas: solo box y rango (la BD filtra por rol). Max. 62 dias. */
export function useRetencionesAjenas(filtro: { desde: string; hasta: string; profesionalId?: string }) {
  return useQuery({
    queryKey: ['panel', 'retenciones-ajenas', filtro],
    queryFn: () => datos(api.GET('/api/agenda/horarios-tomados/ajenos', { params: { query: filtro } })),
    ...sondeoAgenda,
  });
}

export function usePacientes(
  filtro: { profesionalId?: string; nombre?: string; menores?: boolean; duplicados?: boolean; derivados?: boolean } = {},
  habilitado = true,
) {
  return useQuery({
    queryKey: ['panel', 'pacientes', filtro],
    queryFn: () => datos(api.GET('/api/pacientes', { params: { query: filtro } })),
    enabled: habilitado,
    staleTime: MINUTO,
  });
}

export function useEspacios() {
  return useQuery({ queryKey: ['panel', 'espacios'], queryFn: () => datos(api.GET('/api/espacios')), staleTime: 5 * MINUTO });
}

export function useTiposAtencion() {
  return useQuery({ queryKey: ['panel', 'tipos-atencion'], queryFn: () => datos(api.GET('/api/tipos-atencion')), staleTime: 10 * MINUTO });
}

/** id -> "Nombre Apellido" de los pacientes que el rol ve. */
export const nombresPacientes = (lista: PacienteVista[] | undefined) => new Map((lista ?? []).map((p) => [p.id, `${p.nombre} ${p.apellido}`]));

/** Nombre del paciente de una cita; la hora retenida (03b-3.2: reserva sin cuenta en curso) aun no tiene paciente. */
export const nombreDeCita = (nombres: Map<string, string>, c: Pick<CitaVista, 'pacienteId'>) =>
  c.pacienteId ? (nombres.get(c.pacienteId) ?? 'Paciente') : 'Hora retenida';

const ZONA = 'America/Santiago';
const diaChile = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: ZONA });

/** Hoy en Chile como AAAA-MM-DD (para inputs de fecha). */
export const fechaHoyChile = () => diaChile(new Date());

/** Medianoche de Chile del dia AAAA-MM-DD (con el offset vigente ese dia). */
export function inicioDiaChile(fecha: string): Date {
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: ZONA, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${fecha}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', '') || '+00:00';
  return new Date(`${fecha}T00:00:00${offset}`);
}

/** Instante de un dia de Chile a cierta hora local (minutos desde medianoche). */
export const instanteChile = (fecha: string, minutos: number) => new Date(inicioDiaChile(fecha).getTime() + minutos * MINUTO);

/** AAAA-MM-DD sumando dias (calendario, sin zona). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Inicio y fin del dia de hoy en Chile (ISO), para filtrar citas. */
export function hoyChile(): { desde: string; hasta: string } {
  const dia = diaChile(new Date());
  return { desde: inicioDiaChile(dia).toISOString(), hasta: inicioDiaChile(sumarDias(dia, 1)).toISOString() };
}

/** Semana de lunes a domingo en Chile (`desplazamiento` en semanas desde la actual). */
export function semanaChile(desplazamiento = 0): { lunes: string; dias: string[]; desde: string; hasta: string } {
  const hoy = diaChile(new Date());
  const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
  const lunes = sumarDias(hoy, -((dow + 6) % 7) + desplazamiento * 7);
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  return { lunes, dias, desde: inicioDiaChile(lunes).toISOString(), hasta: inicioDiaChile(sumarDias(lunes, 7)).toISOString() };
}

/**
 * 03b-4.1: mes en Chile para la vista mensual (`desplazamiento` en meses).
 * `dias`: semanas completas de lunes a domingo que cubren el mes (con dias
 * del mes anterior y siguiente para completar la grilla).
 */
export function mesChile(desplazamiento = 0, hoy = diaChile(new Date())): { primero: string; dias: string[]; desde: string; hasta: string } {
  const [anio, mes] = hoy.split('-').map(Number) as [number, number];
  const base = new Date(Date.UTC(anio, mes - 1 + desplazamiento, 1, 12));
  const primero = base.toISOString().slice(0, 10);
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
  const inicio = sumarDias(primero, -((base.getUTCDay() + 6) % 7));
  const finDow = new Date(`${ultimo}T12:00:00Z`).getUTCDay();
  const fin = sumarDias(ultimo, (7 - finDow) % 7);
  const dias: string[] = [];
  for (let d = inicio; d <= fin; d = sumarDias(d, 1)) dias.push(d);
  return { primero, dias, desde: inicioDiaChile(inicio).toISOString(), hasta: inicioDiaChile(sumarDias(fin, 1)).toISOString() };
}

export type EstadoFicha = components['schemas']['EstadoFichaPaciente'];
type EstadoFichaPaciente = EstadoFicha;
export type AceptacionVista = components['schemas']['AceptacionVista'];
export type AdultoResponsable = components['schemas']['AdultoResponsableVista'];
export type DerivacionVista = components['schemas']['DerivacionVista'];

export function usePaciente(id: string) {
  return useQuery({ queryKey: ['panel', 'paciente', id], queryFn: () => datos(api.GET('/api/pacientes/{id}', { params: { path: { id } } })) });
}

export function useAdultosResponsables(pacienteId: string) {
  return useQuery({
    queryKey: ['panel', 'paciente', pacienteId, 'adultos'],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/adultos-responsables', { params: { path: { id: pacienteId } } })),
  });
}

export function useAceptaciones(pacienteId: string) {
  return useQuery({
    queryKey: ['panel', 'paciente', pacienteId, 'aceptaciones'],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/aceptaciones', { params: { path: { id: pacienteId } } })),
  });
}

/** Metadata de la ficha (ADMIN y el tratante; GESTION nunca). */
export function useFicha(pacienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['panel', 'paciente', pacienteId, 'ficha'],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/ficha', { params: { path: { id: pacienteId } } })),
    enabled: habilitado,
    retry: false,
  });
}

/** Ultima/proxima sesion y sesiones sin cerrar por paciente de un profesional (ADMIN/GESTION o el propio). */
export function useEstadoFichas(profesionalId: string | undefined) {
  return useQuery({
    queryKey: ['panel', 'estado-fichas', profesionalId],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/estado-fichas', { params: { path: { id: profesionalId! } } })),
    enabled: !!profesionalId,
  });
}

/** 03b-4.2: paciente sin sesion hace mas de un mes, sin proxima hora ni alta (inicio y lista del profesional). */
export const sinSesionHaceUnMes = (e: EstadoFichaPaciente | undefined, ahora = Date.now()) =>
  !!e && !e.alta_en && !e.proxima_sesion && !!e.ultima_sesion && new Date(e.ultima_sesion).getTime() < ahora - 30 * 86_400_000;

/** Evoluciones de la ficha (solo el tratante): aca solo se usa que sesion quedo cerrada. */
export function useEvoluciones(fichaId: string | undefined, habilitado: boolean) {
  return useQuery({
    queryKey: ['panel', 'evoluciones', fichaId],
    queryFn: () => datos(api.GET('/api/fichas/{fichaId}/evoluciones', { params: { path: { fichaId: fichaId! } } })),
    enabled: habilitado && !!fichaId,
  });
}

export function useRespuestasMatch(pacienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['panel', 'paciente', pacienteId, 'respuestas-match'],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/respuestas-match', { params: { path: { id: pacienteId } } })),
    enabled: habilitado,
  });
}

export function useDerivaciones(habilitado: boolean) {
  return useQuery({ queryKey: ['panel', 'derivaciones'], queryFn: () => datos(api.GET('/api/derivaciones')), enabled: habilitado });
}

export function usePerfilesPublicos() {
  return useQuery({ queryKey: ['publico', 'profesionales'], queryFn: () => datos(api.GET('/api/publico/profesionales')), staleTime: 10 * MINUTO });
}

export type MiembroDirectorio = components['schemas']['MiembroDirectorio'];
export type AccesoTemporal = components['schemas']['AccesoTemporalVista'];

/** Equipo con agenda (PROFESIONAL y PRACTICANTE) del directorio interno; la funcion filtra lo que ve cada rol. */
export function useEquipoAgenda() {
  return useQuery({
    queryKey: ['directorio', 'agenda'],
    queryFn: () => datos(api.GET('/api/directorio')),
    select: (lista) => lista.filter((m) => m.roles.includes('PROFESIONAL') || m.roles.includes('PRACTICANTE')),
    staleTime: 5 * MINUTO,
  });
}

/** Accesos clinicos temporales del paciente (ADMIN o el tratante). */
export function useAccesosTemporales(pacienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['panel', 'accesos-temporales', pacienteId],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/accesos-temporales', { params: { path: { id: pacienteId } } })),
    enabled: habilitado,
  });
}
