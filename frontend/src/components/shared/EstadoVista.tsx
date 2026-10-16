'use client';

import type { ReactNode } from 'react';

import { ApiError } from '@/lib/api/errores';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { Icono } from '@/lib/iconos';

type Estado = 'carga' | 'vacio' | 'error' | 'sin-permiso';

const POR_DEFECTO: Record<Estado, { icono: Icono; titulo: string }> = {
  carga: { icono: 'progress_activity', titulo: 'Cargando…' },
  vacio: { icono: 'inbox', titulo: 'Todavía no hay nada aquí' },
  error: { icono: 'error', titulo: 'No pudimos cargar esta información' },
  'sin-permiso': { icono: 'lock', titulo: 'No tienes acceso a esta sección con el rol activo' },
};

interface EstadoVistaProps {
  estado: Estado;
  titulo?: string;
  mensaje?: ReactNode;
  /** Accion principal (vacio) o reintento (error). */
  accion?: ReactNode;
}

/** Los cuatro estados obligatorios de toda vista: carga, vacio, error y sin permiso. */
export function EstadoVista({ estado, titulo, mensaje, accion }: EstadoVistaProps) {
  const base = POR_DEFECTO[estado];
  return (
    <div
      role={estado === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={estado === 'carga' || undefined}
      className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${estado === 'carga' ? 'aparecer-tarde' : 'entrada'}`}
    >
      <Icon name={base.icono} size={28} className={`text-neutral-500 ${estado === 'carga' ? 'animate-spin' : ''}`} />
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
