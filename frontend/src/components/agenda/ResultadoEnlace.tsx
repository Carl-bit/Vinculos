import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { Icono } from '@/lib/iconos';

/** Pantalla de resultado de un enlace del correo (confirmar hora, lista de espera, baja). */
export function ResultadoEnlace({
  icono,
  titulo,
  texto,
  detalle,
  nota,
  accion,
}: {
  icono: Icono;
  titulo: string;
  texto: string;
  detalle?: string;
  nota?: string;
  accion?: ReactNode;
}) {
  return (
    <div role="status" className="entrada max-w-[600px] py-[clamp(32px,6vw,80px)]">
      <span className="mb-6 grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200">
        <Icon name={icono} size={30} className="text-accent-2-700" />
      </span>
      <h1 className="m-0 mb-3.5 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{titulo}</h1>
      <p className="m-0 mb-6 text-[16.5px] leading-relaxed text-pretty text-neutral-700">{texto}</p>
      {detalle && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-divider bg-neutral-100 px-6 py-5 shadow-sm">
          <Icon name="event_available" size={20} className="text-accent-2-700" />
          <span className="text-[15.5px] font-black tracking-[-0.02em] first-letter:uppercase">{detalle}</span>
        </div>
      )}
      {nota && <p className="m-0 mb-6 rounded-[16px] border border-accent-500 bg-accent-200 px-4 py-3 text-[13px] font-bold text-accent-900">{nota}</p>}
      {accion}
    </div>
  );
}
