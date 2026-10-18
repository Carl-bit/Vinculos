import type { ReactNode } from 'react';

/**
 * Seccion de una pagina (diseño "Mi Cuenta"): h2 de 20 px en 900, bajada
 * secundaria y contenido. `claro` = superficie neutral-100 (por defecto),
 * `paciente` = bloque verde ("Mi profesional"), `equipo` = bloque terracota.
 * Nunca se anida un Panel dentro de otro.
 */
const VARIANTES = {
  claro: 'border border-divider bg-neutral-100',
  paciente: 'border border-accent-2-500 bg-accent-2-200',
  equipo: 'border border-accent-500 bg-accent-200',
} as const;

export function Panel({
  titulo,
  bajada,
  accion,
  variante = 'claro',
  id,
  children,
  className = '',
  nivel = 2,
}: {
  titulo?: ReactNode;
  bajada?: ReactNode;
  accion?: ReactNode;
  variante?: keyof typeof VARIANTES;
  id?: string;
  children?: ReactNode;
  className?: string;
  nivel?: 2 | 3;
}) {
  const H = nivel === 2 ? 'h2' : 'h3';
  return (
    <section id={id} className={`min-w-0 rounded-lg px-[clamp(20px,3vw,28px)] pt-[26px] pb-[26px] shadow-sm ${VARIANTES[variante]} ${className}`}>
      {(titulo || accion) && (
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-1">
          {titulo && <H className="m-0 text-[20px] leading-tight font-black tracking-[-0.025em] text-balance">{titulo}</H>}
          {accion}
        </div>
      )}
      {bajada && <p className="m-0 mb-[18px] text-[13.5px] font-semibold text-pretty text-neutral-700">{bajada}</p>}
      {!bajada && titulo && <div className="mb-3" />}
      {children}
    </section>
  );
}
