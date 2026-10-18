import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { Icono } from '@/lib/iconos';

/** Resultado dentro de la tarjeta de cuenta (enlace enviado, contraseña cambiada, enlace vencido). */
export function ResultadoCuenta({ icono, titulo, children, accion }: { icono: Icono; titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div role="status" className="entrada flex flex-col gap-3">
      <span className="grid size-[52px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
        <Icon name={icono} size={26} />
      </span>
      <h1 className="m-0 text-[clamp(25px,3vw,30px)] leading-[1.05] font-black tracking-[-0.03em] text-balance">{titulo}</h1>
      {children && <div className="text-[14.5px] leading-relaxed text-pretty text-neutral-700">{children}</div>}
      {accion && <div className="mt-2 flex flex-col gap-2">{accion}</div>}
    </div>
  );
}
