'use client';

import { MutationCache, QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api/errores';

/** Un 4xx no se reintenta (permiso, regla o no existe: reintentar no cambia nada). */
const reintentar = (fallos: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && fallos < 2;

const SEGUNDO = 1000;
/** Datos fijos (staleTime Infinity: politica vigente, enlace firmado): ni sondeo ni recarga en cadena. */
const fijo = (q: Query) => (q.options as { staleTime?: unknown }).staleTime === Infinity;

/**
 * Punto 10 (tiempo real por polling, sin websockets ni SSE): toda consulta
 * visible se vuelve a pedir sola. Cada 30 s por defecto; las de catalogo
 * (staleTime largo) cada 2 min como maximo. Solo con la pestaña visible.
 */
export const intervaloSondeo = (q: Query) => {
  if (fijo(q)) return false;
  const stale = (q.options as { staleTime?: unknown }).staleTime;
  return typeof stale === 'number' && stale > 30 * SEGUNDO ? Math.min(stale, 120 * SEGUNDO) : 30 * SEGUNDO;
};

/** Lo que cambia por acciones de otros y no admite demora (horas libres, calendario, citas, chat): cada 15 s. */
export const RAPIDAS: readonly (readonly string[])[] = [
  ['huecos'],
  ['agenda'],
  ['disponibilidad-publica'],
  ['disponibilidad-portal'],
  ['panel', 'citas'],
  ['panel', 'cita'],
  ['panel', 'bloqueos'],
  ['panel', 'espacios'],
  ['portal', 'citas'],
  ['portal', 'estado-tratante'],
  ['portal', 'mensajes'],
  ['hilos'],
];

export function crearCliente() {
  const cliente: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: reintentar, refetchOnWindowFocus: true, refetchInterval: intervaloSondeo, refetchIntervalInBackground: false },
    },
    // Efecto domino en la misma sesion: cualquier accion (resulte o falle, p. ej. un 409 por dato viejo)
    // vuelve a pedir todo lo que esta en pantalla y marca vencido el resto. Las consultas fijas no se tocan.
    mutationCache: new MutationCache({
      onSettled: () => void cliente.invalidateQueries({ predicate: (q) => !fijo(q) }),
    }),
  });
  for (const clave of RAPIDAS) cliente.setQueryDefaults(clave, { refetchInterval: 15 * SEGUNDO });
  return cliente;
}

export function Proveedores({ children }: { children: ReactNode }) {
  const [cliente] = useState(crearCliente);
  // Punto 4: si el navegador restaura la pagina desde su cache (atras/adelante), se recarga: la guarda de
  // sesion vuelve a correr (sin sesion, al ingreso) y el formulario de ingreso aparece vacio.
  useEffect(() => {
    const alMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', alMostrar);
    return () => window.removeEventListener('pageshow', alMostrar);
  }, []);
  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
