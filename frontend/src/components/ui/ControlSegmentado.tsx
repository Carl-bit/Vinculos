'use client';

import { useId } from 'react';

import type { Icono } from '@/lib/iconos';

import { Icon } from './Icon';

export interface OpcionSegmento<T extends string> {
  valor: T;
  etiqueta: string;
  icono?: Icono;
}

interface Props<T extends string> {
  /** Nombre accesible del grupo (p. ej. "Modalidad"). */
  etiqueta: string;
  opciones: readonly OpcionSegmento<T>[];
  valor: T;
  onChange: (valor: T) => void;
  /** patient: verde (publico y portal); team: terracota (panel). */
  tono?: 'patient' | 'team';
  /** Muestra la etiqueta del grupo sobre el control. */
  conLeyenda?: boolean;
  className?: string;
}

/**
 * Control segmentado (03b-4.1): opciones excluyentes en una pildora, cada una
 * con icono y estado activo relleno. Radios nativos: flechas del teclado,
 * foco visible y lector de pantalla sin ARIA extra.
 */
export function ControlSegmentado<T extends string>({ etiqueta, opciones, valor, onChange, tono = 'patient', conLeyenda = false, className = '' }: Props<T>) {
  const nombre = useId();
  const activo = tono === 'patient' ? 'bg-accent-2-700 text-neutral-100 shadow-sm' : 'bg-accent-700 text-neutral-100 shadow-sm';
  const reposo = tono === 'patient' ? 'text-text hover:bg-accent-2-100' : 'text-text hover:bg-accent-100';
  return (
    <fieldset className={`m-0 min-w-0 border-0 p-0 ${className}`}>
      <legend className={conLeyenda ? 'mb-2.5 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase' : 'sr-only'}>{etiqueta}</legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-full border-[1.5px] border-neutral-400 bg-bg p-1">
        {opciones.map((o) => {
          const marcada = o.valor === valor;
          return (
            <label
              key={o.valor}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-[18px] text-[14.5px] font-extrabold transition-colors duration-200 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent motion-reduce:transition-none ${
                marcada ? activo : reposo
              }`}
            >
              <input type="radio" name={nombre} value={o.valor} checked={marcada} onChange={() => onChange(o.valor)} className="sr-only" />
              {o.icono && <Icon name={o.icono} size={20} className={marcada ? "[font-variation-settings:'FILL'_1]" : ''} />}
              {o.etiqueta}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
