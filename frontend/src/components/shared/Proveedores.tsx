'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api/errores';

/** Un 4xx no se reintenta (permiso, regla o no existe: reintentar no cambia nada). */
const reintentar = (fallos: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && fallos < 2;

export function Proveedores({ children }: { children: ReactNode }) {
  const [cliente] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: reintentar, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
