'use client';

/** Configuracion del centro (03b-4): parametros, contenido publico, politicas y horario. Escribe solo ADMIN. */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type ConfiguracionCentro = components['schemas']['ConfiguracionCentroVista'];
export type ContenidoPublico = components['schemas']['ContenidoPublicoVista'];
export type PoliticaVista = components['schemas']['PoliticaVista'];
export type HorarioCentro = components['schemas']['HorarioCentroVista'];

export function useConfiguracionCentro() {
  return useQuery({ queryKey: ['configuracion'], queryFn: () => datos(api.GET('/api/configuracion')), staleTime: 5 * 60_000 });
}

export function useContenidoPublico() {
  return useQuery({ queryKey: ['configuracion', 'contenido'], queryFn: () => datos(api.GET('/api/configuracion/contenido-publico')) });
}

export function usePoliticas() {
  return useQuery({ queryKey: ['configuracion', 'politicas'], queryFn: () => datos(api.GET('/api/politicas')) });
}

export function useHorarioCentro() {
  return useQuery({ queryKey: ['configuracion', 'horario'], queryFn: () => datos(api.GET('/api/configuracion/horario')) });
}
