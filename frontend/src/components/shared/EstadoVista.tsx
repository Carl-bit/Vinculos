'use client';

import type { ReactNode } from 'react';

import { ApiError } from '@/lib/api/errores';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { Icono } from '@/lib/iconos';

type Estado = 'carga' | 'vacio' | 'error' | 'sin-permiso' | 'sin-modulo';

const POR_DEFECTO: Record<Estado, { icono: Icono; titulo: string }> = {
  carga: { icono: 'progress_activity', titulo: 'Cargando…' },
  vacio: { icono: 'inbox', titulo: 'Todavía no hay nada aquí' },
  error: { icono: 'error', titulo: 'No pudimos cargar esta información' },
  'sin-permiso': { icono: 'lock', titulo: 'No tienes acceso a esta sección con el rol activo' },
  'sin-modulo': { icono: 'lock', titulo: 'Esta sección no está activa en tu centro' },
};

interface EstadoVistaProps {
  estado: Estado;
  titulo?: string;
  mensaje?: ReactNode;
  /** Accion principal (vacio) o reintento (error). */
  accion?: ReactNode;
}

/**
 * Los cuatro estados obligatorios de toda vista: carga, vacio, error y sin permiso.
 * 03b-6: la carga es un skeleton (barras con barrido, aparece pasados 300 ms
 * para no parpadear) y los demas llevan una ilustracion: el icono en un
 * circulo de color suave, sin tile cuadrado (regla del proyecto).
 */
export function EstadoVista({ estado, titulo, mensaje, accion }: EstadoVistaProps) {
  const base = POR_DEFECTO[estado];
  if (estado === 'carga') {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="aparecer-tarde flex flex-col gap-3 px-2 py-6">
        <span className="sr-only">{titulo ?? base.titulo}</span>
        <span aria-hidden="true" className="esqueleto h-5 w-2/5 rounded-full" />
        <span aria-hidden="true" className="esqueleto h-16 w-full rounded-tarjeta" />
        <span aria-hidden="true" className="esqueleto h-16 w-full rounded-tarjeta" />
        <span aria-hidden="true" className="esqueleto h-4 w-3/5 rounded-full" />
      </div>
    );
  }
  const tono =
    estado === 'vacio' ? 'bg-accent-2-100 text-accent-2-700' : estado === 'error' ? 'bg-accent-100 text-accent-700' : 'bg-neutral-200 text-neutral-700';
  return (
    <div role={estado === 'error' ? 'alert' : 'status'} aria-live="polite" className="entrada flex flex-col items-center gap-3 px-6 py-12 text-center [@media(max-height:860px)]:py-6">
      <span aria-hidden="true" className={`relative mb-1 grid size-[72px] place-items-center rounded-full ${tono}`}>
        <span className="absolute inset-[-8px] rounded-full border border-dashed border-current opacity-30" />
        <Icon name={base.icono} size={32} />
      </span>
      <p className="m-0 text-base font-extrabold tracking-[-0.01em]">{titulo ?? base.titulo}</p>
      {mensaje && <p className="m-0 max-w-md text-[13.5px] font-semibold text-neutral-800">{mensaje}</p>}
      {accion}
    </div>
  );
}

interface EstadoConsultaProps<T> {
  consulta: { isPending: boolean; error: unknown; data?: T; refetch: () => unknown };
  vacio?: (datos: T) => boolean;
  textoVacio?: string;
  accionVacio?: ReactNode;
  children: (datos: T) => ReactNode;
}

/** Atajo para una consulta de React Query: elige el estado y, si hay datos, los entrega. */
export function EstadoConsulta<T>({ consulta, vacio, textoVacio, accionVacio, children }: EstadoConsultaProps<T>) {
  if (consulta.isPending) return <EstadoVista estado="carga" />;
  if (consulta.error) {
    const e = consulta.error;
    if (e instanceof ApiError && e.status === 403) return <EstadoVista estado="sin-permiso" />;
    return (
      <EstadoVista
        estado="error"
        mensaje={e instanceof ApiError ? e.message : undefined}
        accion={
          <Button variant="secondary" icon="refresh" onClick={() => void consulta.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  }
  const datos = consulta.data as T;
  if (vacio?.(datos)) return <EstadoVista estado="vacio" titulo={textoVacio} accion={accionVacio} />;
  return <>{children(datos)}</>;
}
