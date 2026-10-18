import type { ReactNode } from 'react';

import type { Icono } from '@/lib/iconos';

import { Icon } from './Icon';

/**
 * Bloque de aviso del diseño (Mi Cuenta): advertencia en terracota, exito en
 * verde, nota neutra con borde punteado. El icono va suelto junto al texto,
 * nunca dentro de un tile.
 */
const TONOS = {
  advertencia: { caja: 'border border-accent-500 bg-accent-200 text-accent-900', icono: 'text-accent-700', base: 'warning' },
  exito: { caja: 'border border-accent-2-500 bg-accent-2-200 text-accent-2-900', icono: 'text-accent-2-700', base: 'check_circle' },
  nota: { caja: 'border-[1.5px] border-dashed border-neutral-400 bg-bg text-neutral-800', icono: 'text-neutral-700', base: 'lock' },
  info: { caja: 'border border-divider bg-neutral-100 text-neutral-800', icono: 'text-neutral-700', base: 'info' },
} as const satisfies Record<string, { caja: string; icono: string; base: Icono }>;

export type TonoAviso = keyof typeof TONOS;

export function Aviso({
  tono = 'info',
  icono,
  titulo,
  children,
  accion,
  role,
  className = '',
}: {
  tono?: TonoAviso;
  icono?: Icono;
  titulo?: ReactNode;
  children?: ReactNode;
  accion?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  const t = TONOS[tono];
  return (
    <div role={role} className={`flex gap-3 rounded-[18px] px-[18px] py-4 ${t.caja} ${className}`}>
      <Icon name={icono ?? t.base} size={20} className={`mt-px ${t.icono}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {titulo && <p className="m-0 text-[13.5px] font-extrabold text-pretty">{titulo}</p>}
        {children && <div className="m-0 text-[13px] leading-relaxed font-bold text-pretty">{children}</div>}
        {accion && <div className="mt-1.5 flex flex-wrap gap-2.5">{accion}</div>}
      </div>
    </div>
  );
}
