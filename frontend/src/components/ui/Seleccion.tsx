'use client';

import { useState, type ReactNode } from 'react';

/**
 * Seleccion multiple para tablas (punto 24: tomar filas por grupos y aplicar
 * una accion rapida). `marcarPagina` marca o desmarca las filas visibles.
 */
export function useSeleccion() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) =>
    setIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const marcarPagina = (visibles: string[], marcar: boolean) =>
    setIds((s) => {
      const n = new Set(s);
      for (const id of visibles) {
        if (marcar) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  return { ids, alternar, marcarPagina, limpiar: () => setIds(new Set()) };
}

/** Casilla de una fila o del encabezado ("toda la pagina", con estado intermedio). */
export function CasillaFila({
  marcada,
  intermedia = false,
  onChange,
  etiqueta,
  deshabilitada = false,
}: {
  marcada: boolean;
  intermedia?: boolean;
  onChange: (v: boolean) => void;
  etiqueta: string;
  deshabilitada?: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label={etiqueta}
      checked={marcada}
      disabled={deshabilitada}
      ref={(el) => {
        if (el) el.indeterminate = intermedia;
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="size-[18px] cursor-pointer accent-accent-2-600 disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** Barra de acciones rapidas: aparece con al menos una fila marcada. */
export function BarraSeleccion({ cantidad, onLimpiar, children }: { cantidad: number; onLimpiar: () => void; children: ReactNode }) {
  if (cantidad === 0) return null;
  return (
    <div
      role="region"
      aria-label="Acciones para lo seleccionado"
      className="flex flex-wrap items-center gap-2.5 rounded-lg border border-accent-2-500 bg-accent-2-100 px-4 py-2.5"
    >
      <span className="text-[13.5px] font-extrabold text-accent-2-900">
        {cantidad} {cantidad === 1 ? 'seleccionado' : 'seleccionados'}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onLimpiar}
        className="ml-auto min-h-9 cursor-pointer text-[13px] font-extrabold text-accent-2-800 underline underline-offset-2"
      >
        Quitar selección
      </button>
    </div>
  );
}
