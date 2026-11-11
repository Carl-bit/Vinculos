'use client';

import { useEffect, useState } from 'react';

import { Icon } from './Icon';

/** Tamaños de pagina: minimo 10 (punto 45: tablas de 10 que se recorren por pagina, sin scroll infinito). */
export const TAMANOS_PAGINA = [10, 20, 50] as const;

/**
 * Numeros a mostrar: siempre la primera y la ultima, la actual con sus
 * vecinas y "…" en los saltos. Ej.: (7 de 12) -> 1 … 6 7 8 … 12.
 */
export function paginasVisibles(actual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const nums = new Set([1, total, actual - 1, actual, actual + 1].filter((n) => n >= 1 && n <= total));
  const orden = [...nums].sort((a, b) => a - b);
  return orden.flatMap((n, i) => (i > 0 && n - orden[i - 1]! > 1 ? ['…' as const, n] : [n]));
}

/**
 * Pagina una lista en el cliente. El tamaño elegido es una preferencia de
 * quien mira (localStorage por `clave`, nunca datos); la pagina vuelve a 1
 * cuando cambia el filtro (`reinicio`).
 */
export function usePaginacion<T>(items: readonly T[], clave: string, reinicio?: unknown) {
  const [porPagina, setPorPaginaEstado] = useState<number>(TAMANOS_PAGINA[0]);
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    try {
      const guardado = Number(localStorage.getItem(`paginador:${clave}`));
      if ((TAMANOS_PAGINA as readonly number[]).includes(guardado)) setPorPaginaEstado(guardado);
    } catch {
      // Sin almacenamiento (privado o bloqueado): queda el minimo.
    }
  }, [clave]);
  useEffect(() => setPagina(1), [reinicio]);
  const totalPaginas = Math.max(1, Math.ceil(items.length / porPagina));
  const actual = Math.min(pagina, totalPaginas);
  const setPorPagina = (n: number) => {
    setPorPaginaEstado(n);
    setPagina(1);
    try {
      localStorage.setItem(`paginador:${clave}`, String(n));
    } catch {
      // Igual funciona sin recordarlo.
    }
  };
  return {
    visibles: items.slice((actual - 1) * porPagina, actual * porPagina),
    pagina: actual,
    totalPaginas,
    porPagina,
    setPagina,
    setPorPagina,
    total: items.length,
  };
}

const boton =
  'grid min-h-9 min-w-9 cursor-pointer place-items-center rounded-full px-2 text-[13px] font-extrabold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40';

/** Pie de tabla: "1–10 de 34", filas por pagina y paginas numeradas. */
export function Paginador({
  pagina,
  totalPaginas,
  porPagina,
  total,
  setPagina,
  setPorPagina,
  etiqueta = 'filas',
}: {
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  total: number;
  setPagina: (n: number) => void;
  setPorPagina: (n: number) => void;
  etiqueta?: string;
}) {
  if (total <= TAMANOS_PAGINA[0]) return null;
  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);
  return (
    <nav aria-label={`Páginas de ${etiqueta}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-3">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] font-semibold text-neutral-700">
        <span aria-live="polite">
          {desde}–{hasta} de {total}
        </span>
        <label className="flex items-center gap-1.5">
          Mostrar
          <select
            value={porPagina}
            onChange={(e) => setPorPagina(Number(e.target.value))}
            className="min-h-9 cursor-pointer rounded-full border border-divider bg-bg px-2.5 text-[12.5px] font-bold text-text"
          >
            {TAMANOS_PAGINA.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {etiqueta}
        </label>
      </div>
      <ul className="m-0 flex list-none items-center gap-1 p-0">
        <li>
          <button
            type="button"
            aria-label="Página anterior"
            disabled={pagina === 1}
            onClick={() => setPagina(pagina - 1)}
            className={`${boton} hover:bg-accent-100`}
          >
            <Icon name="chevron_left" size={18} />
          </button>
        </li>
        {paginasVisibles(pagina, totalPaginas).map((n, i) =>
          n === '…' ? (
            <li key={`s${i}`} aria-hidden="true" className="px-1 text-[13px] font-bold text-neutral-700">
              …
            </li>
          ) : (
            <li key={n}>
              <button
                type="button"
                aria-label={`Página ${n}`}
                aria-current={n === pagina ? 'page' : undefined}
                onClick={() => setPagina(n)}
                className={`${boton} ${n === pagina ? 'bg-accent-700 text-neutral-100' : 'hover:bg-accent-100'}`}
              >
                {n}
              </button>
            </li>
          ),
        )}
        <li>
          <button
            type="button"
            aria-label="Página siguiente"
            disabled={pagina === totalPaginas}
            onClick={() => setPagina(pagina + 1)}
            className={`${boton} hover:bg-accent-100`}
          >
            <Icon name="chevron_right" size={18} />
          </button>
        </li>
      </ul>
    </nav>
  );
}
