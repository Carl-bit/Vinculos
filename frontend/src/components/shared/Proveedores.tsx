'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api/errores';

/** Un 4xx no se reintenta (permiso, regla o no existe: reintentar no cambia nada). */
const reintentar = (fallos: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && fallos < 2;

export function Proveedores({ children }: { children: ReactNode }) {
  const [cliente] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: reintentar, refetchOnWindowFocus: false } } }));
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
