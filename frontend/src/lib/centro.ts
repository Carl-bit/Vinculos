'use client';

/** Configuracion del centro (03b-4): parametros, contenido publico, politicas y horario. Escribe solo ADMIN. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type ConfiguracionCentro = components['schemas']['ConfiguracionCentroVista'];
export type ContenidoPublico = components['schemas']['ContenidoPublicoVista'];
export type PoliticaVista = components['schemas']['PoliticaVista'];
export type HorarioCentro = components['schemas']['HorarioCentroVista'];
export type LecturaProtocolo = components['schemas']['LecturaProtocoloVista'];

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

/** 03b-4.2: protocolo interno vigente y si la cuenta ya lo leyo (equipo). */
export function useProtocoloEquipo() {
  return useQuery({ queryKey: ['protocolo'], queryFn: () => datos(api.GET('/api/protocolo')) });
}

export function useMarcarProtocoloLeido() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => datos(api.POST('/api/protocolo/lectura')),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['protocolo'] }),
  });
}

/** ADMIN/GESTION: quien leyo la version vigente; los nombres vienen del directorio interno. */
export function useLecturasProtocolo(habilitado: boolean) {
  return useQuery({ queryKey: ['protocolo', 'lecturas'], queryFn: () => datos(api.GET('/api/protocolo/lecturas')), enabled: habilitado });
}

export function useDirectorioEquipo(habilitado: boolean) {
  return useQuery({ queryKey: ['directorio', 'todos'], queryFn: () => datos(api.GET('/api/directorio')), enabled: habilitado, staleTime: 5 * 60_000 });
}
