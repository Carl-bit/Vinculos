'use client';

import { Button } from '@/components/ui/Button';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Icon } from '@/components/ui/Icon';

export type VistaAgenda = 'semana' | 'mes';

/**
 * Cabecera de periodo de la agenda (03b-4.1): "< periodo >", control
 * Semana | Mes y "Hoy" (vuelve al periodo actual; deshabilitado si ya esta).
 */
export function SelectorPeriodo({
  vista,
  onVista,
  etiqueta,
  desplazamiento,
  onDesplazar,
}: {
  vista: VistaAgenda;
  onVista: (v: VistaAgenda) => void;
  etiqueta: string;
  desplazamiento: number;
  onDesplazar: (n: number) => void;
}) {
  const unidad = vista === 'semana' ? 'Semana' : 'Mes';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`${unidad} anterior`}
          onClick={() => onDesplazar(desplazamiento - 1)}
          className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
        >
          <Icon name="chevron_left" />
        </button>
        <span className="min-w-[190px] text-center text-[14px] font-extrabold text-neutral-800 first-letter:uppercase" aria-live="polite">
          {etiqueta}
        </span>
        <button
          type="button"
          aria-label={`${unidad} siguiente`}
          onClick={() => onDesplazar(desplazamiento + 1)}
          className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
        >
          <Icon name="chevron_right" />
        </button>
      </div>
      <ControlSegmentado
        etiqueta="Vista de la agenda"
        tono="team"
        valor={vista}
        onChange={onVista}
        opciones={[
          { valor: 'semana', etiqueta: 'Semana', icono: 'view_week' },
          { valor: 'mes', etiqueta: 'Mes', icono: 'calendar_view_month' },
        ]}
      />
      <Button variant="secondary" icon="today" disabled={desplazamiento === 0} onClick={() => onDesplazar(0)}>
        Hoy
      </Button>
    </div>
  );
}
