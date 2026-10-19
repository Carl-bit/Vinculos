'use client';

/**
 * Consultas de la ficha clinica (03b-5.1). Contenido clinico: solo memoria
 * (React Query), nunca storage ni logs; la cache se vacia al cambiar de rol.
 * La RLS de la API decide que ve cada rol (tratante, acceso temporal).
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';
import { useMiCuenta } from './consultas';
import { useEspecialidadesDe } from './equipo';

export type EvolucionVista = components['schemas']['EvolucionVista'];
export type EvolucionCreada = components['schemas']['EvolucionCreada'];
export type IngresoVista = components['schemas']['IngresoVista'];
export type BorradorVista = components['schemas']['BorradorVista'];
export type PlantillaClinica = components['schemas']['PlantillaClinicaVista'];
export type TipoPlantilla = components['schemas']['TipoPlantillaClinica'];
export type EstadoPlantilla = components['schemas']['EstadoPlantillaClinica'];
export type TipoSesion = components['schemas']['TipoSesionVista'];
export type CatalogoClinico = components['schemas']['CatalogoClinicoVista'];
export type TipoDocumento = components['schemas']['TipoDocumentoVista'];
export type DocumentoClinico = components['schemas']['DocumentoClinicoVista'];
export type EnvioDocumento = components['schemas']['EnvioDocumentoDetalle'];
export type AdjuntoFicha = components['schemas']['AdjuntoFichaVista'];
export type AltaVista = components['schemas']['AltaVista'];
export type FichaSobreRetencion = components['schemas']['FichaSobreRetencion'];
export type RevisionRetencion = components['schemas']['RevisionRetencionVista'];
export type NivelRiesgo = components['schemas']['NivelRiesgo'];

const MINUTO = 60_000;

export const NIVEL_RIESGO: Record<NivelRiesgo, { texto: string; tono: 'positivo' | 'atencion' | 'neutro' }> = {
  NINGUNO: { texto: 'Sin riesgo', tono: 'neutro' },
  BAJO: { texto: 'Riesgo bajo', tono: 'neutro' },
  MEDIO: { texto: 'Riesgo medio', tono: 'atencion' },
  ALTO: { texto: 'Riesgo alto', tono: 'atencion' },
};

export const TIPO_PLANTILLA: Record<TipoPlantilla, string> = { INGRESO: 'Ficha de ingreso', EVOLUCION: 'Evolución' };

export const ESTADO_PLANTILLA: Record<EstadoPlantilla, { texto: string; tono: 'positivo' | 'atencion' | 'neutro' }> = {
  BORRADOR: { texto: 'Borrador', tono: 'atencion' },
  PUBLICADA: { texto: 'Publicada', tono: 'positivo' },
  INACTIVA: { texto: 'Inactiva', tono: 'neutro' },
};

export function useIngresos(fichaId: string | undefined) {
  return useQuery({
    queryKey: ['ficha', fichaId, 'ingresos'],
    queryFn: () => datos(api.GET('/api/fichas/{fichaId}/ingresos', { params: { path: { fichaId: fichaId! } } })),
    enabled: !!fichaId,
  });
}

/** Borradores propios (la RLS solo devuelve los del autor). Sin ficha: todos los pendientes. */
export function useBorradores(fichaId?: string, habilitado = true) {
  return useQuery({
    queryKey: ['borradores', fichaId ?? 'todos'],
    queryFn: () => datos(api.GET('/api/borradores', { params: { query: fichaId ? { fichaId } : {} } })),
    enabled: habilitado,
  });
}

export function usePlantillas(filtro: { especialidadId?: string; tipo?: TipoPlantilla; estado?: EstadoPlantilla } = {}, habilitado = true) {
  return useQuery({
    queryKey: ['plantillas-clinicas', filtro],
    queryFn: () => datos(api.GET('/api/plantillas-clinicas', { params: { query: filtro } })),
    enabled: habilitado,
    staleTime: 5 * MINUTO,
  });
}

/**
 * Plantillas publicadas que el usuario puede usar: las de sus especialidades
 * aprobadas. Sin especialidades aprobadas (p. ej. un practicante) se ofrecen
 * todas las publicadas y la API rechaza (422) la que no corresponda.
 */
export function usePlantillasAplicables(tipo: TipoPlantilla) {
  const cuenta = useMiCuenta();
  const especialidades = useEspecialidadesDe(cuenta.data?.id);
  const plantillas = usePlantillas({ tipo, estado: 'PUBLICADA' });
  const aprobadas = new Set((especialidades.data ?? []).filter((e) => e.estado === 'APROBADO').map((e) => e.especialidadId));
  const todas = plantillas.data ?? [];
  return { consulta: plantillas, lista: aprobadas.size ? todas.filter((p) => aprobadas.has(p.especialidadId)) : todas };
}

export function useTiposSesion(estado?: TipoSesion['estado']) {
  return useQuery({
    queryKey: ['catalogos', 'tipos-sesion', estado ?? 'todos'],
    queryFn: () => datos(api.GET('/api/tipos-sesion', { params: { query: estado ? { estado } : {} } })),
    staleTime: 5 * MINUTO,
  });
}

export function useIntervenciones() {
  return useQuery({ queryKey: ['catalogos', 'intervenciones'], queryFn: () => datos(api.GET('/api/intervenciones')), staleTime: 5 * MINUTO });
}

export function useEstadosAvance() {
  return useQuery({ queryKey: ['catalogos', 'estados-avance'], queryFn: () => datos(api.GET('/api/estados-avance')), staleTime: 5 * MINUTO });
}

export function useTiposDocumento(habilitado = true) {
  return useQuery({
    queryKey: ['catalogos', 'tipos-documento'],
    queryFn: () => datos(api.GET('/api/tipos-documento-clinico')),
    enabled: habilitado,
    staleTime: 5 * MINUTO,
  });
}

export function useDocumentosPaciente(pacienteId: string) {
  return useQuery({
    queryKey: ['ficha', 'documentos', pacienteId],
    queryFn: () => datos(api.GET('/api/documentos-clinicos', { params: { query: { pacienteId } } })),
  });
}

export function useEnviosDocumento(documentoId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['ficha', 'envios', documentoId],
    queryFn: () => datos(api.GET('/api/documentos-clinicos/{id}/envios', { params: { path: { id: documentoId } } })),
    enabled: habilitado,
  });
}

export function useAdjuntos(pacienteId: string) {
  return useQuery({
    queryKey: ['ficha', 'adjuntos', pacienteId],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/adjuntos', { params: { path: { id: pacienteId } } })),
  });
}

export function useAltas(pacienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['ficha', 'altas', pacienteId],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/altas', { params: { path: { id: pacienteId } } })),
    enabled: habilitado,
  });
}

/** Revision de retencion (solo ADMIN): cada consulta queda registrada en la BD, asi que no se repite sola. */
export function useFichasRetencion(habilitado: boolean) {
  return useQuery({
    queryKey: ['retencion', 'fichas'],
    queryFn: () => datos(api.GET('/api/retencion/fichas')),
    enabled: habilitado,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useRevisionesRetencion(habilitado: boolean) {
  return useQuery({ queryKey: ['retencion', 'revisiones'], queryFn: () => datos(api.GET('/api/retencion/revisiones')), enabled: habilitado });
}

/** Correcciones: id del registro corregido -> su correccion mas reciente (append-only). */
export function correccionesDe<T extends { id: string; corrigeAId: string | null; createdAt: string }>(lista: readonly T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const r of [...lista].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (r.corrigeAId) mapa.set(r.corrigeAId, r);
  }
  return mapa;
}
