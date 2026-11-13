'use client';

import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { api, datos } from './api/cliente';
import { estadoSesion, suscribirSesion, type EstadoSesion } from './sesion';

const DESCONOCIDA: EstadoSesion = { tipo: 'desconocida' };

export function useSesion(): EstadoSesion {
  return useSyncExternalStore(suscribirSesion, estadoSesion, () => DESCONOCIDA);
}

/** Modulos contratados (la API los cachea 30 s; aca 60 s). */
/** Contenido publico del centro (nombre, colores de marca por zona...). Misma clave que el resto de las vistas. */
export function useCentroPublico() {
  return useQuery({ queryKey: ['publico', 'centro'], queryFn: () => datos(api.GET('/api/publico/centro')), staleTime: 10 * 60_000 });
}

export function useModulos() {
  // Punto 36: lo que el perfil de la cuenta restringe se trata como no activo (menu, accesos y vistas lo ocultan; la API responde 403).
  return useQuery({
    queryKey: ['modulos'],
    queryFn: () => datos(api.GET('/api/modulos')),
    staleTime: 60_000,
    select: (d) => ({ ...d, activos: d.activos.filter((m) => !d.restringidos.includes(m)) }),
  });
}

export function useMiCuenta() {
  return useQuery({ queryKey: ['usuarios', 'yo'], queryFn: () => datos(api.GET('/api/usuarios/yo')), staleTime: 5 * 60_000 });
}

/** Profesionales del centro para el selector de equipo (ADMIN/GESTION). */
export function useProfesionales(habilitado: boolean) {
  return useQuery({
    queryKey: ['directorio', 'PROFESIONAL'],
    queryFn: () => datos(api.GET('/api/directorio', { params: { query: { rol: 'PROFESIONAL' } } })),
    enabled: habilitado,
    staleTime: 5 * 60_000,
  });
}
