'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';

import { NOMBRE_RESPALDO } from '@/lib/marca';

/**
 * Nombre del centro en runtime (R11): lo resuelve el layout raiz en el
 * servidor (lib/centro.ts) y lo entrega aqui; los layouts cliente (admin,
 * portal) lo leen sin depender de un valor horneado en el build.
 */
const NombreCentro = createContext<string>(NOMBRE_RESPALDO);

export function ProveedorNombreCentro({ nombre, children }: { nombre: string; children: ReactNode }) {
  return <NombreCentro.Provider value={nombre}>{children}</NombreCentro.Provider>;
}

export function useNombreCentro(): string {
  return useContext(NombreCentro);
}

/** Punto de color + nombre del centro (header publico, portal y sidebar). */
export function Marca({ href = '/', size = 'lg', nombre }: { href?: string; size?: 'lg' | 'sm'; nombre?: string }) {
  const delSilo = useNombreCentro();
  return (
    <Link href={href} className="flex min-w-0 items-center gap-[9px] text-text hover:text-text">
      <span aria-hidden="true" className={`inline-block flex-none rounded-full bg-accent-2-600 ${size === 'lg' ? 'size-[11px]' : 'size-2.5'}`} />
      <span className={`marca-centro truncate font-black tracking-[-0.04em] ${size === 'lg' ? 'text-xl' : 'text-[17px]'}`}>{nombre ?? delSilo}</span>
    </Link>
  );
}
