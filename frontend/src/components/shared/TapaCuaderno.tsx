import type { ReactNode } from 'react';

/**
 * Tema Cuaderno (design-reference/Segundo Silo): cada profesional es un
 * cuaderno con tapa de color fijo (uno de seis segun su lugar en el equipo
 * publico, el mismo orden en todo el sitio), lomo, elastico y etiqueta blanca
 * con su nombre.
 * El lomo y el elastico son decorativos; el nombre es texto real.
 */
const TAPAS = ['#D4A23A', '#A6442E', '#2E6E6E', '#2F4A6B', '#4F6B2F', '#B08A5E'];

export function TapaCuaderno({
  orden,
  nombre,
  especialidad,
  alto,
  sello,
}: {
  /** Lugar del profesional en perfilesPublicos (no en una lista filtrada). */
  orden: number;
  nombre: string;
  especialidad?: string | null;
  /** Alto fijo (listado del equipo); sin alto, proporcion 3:4 (portada). */
  alto?: number;
  /** Sello redondo sobre la tapa (registro SIS verificado). */
  sello?: ReactNode;
}) {
  return (
    <span
      className="tapa relative flex w-full items-center justify-center shadow-[0_14px_26px_rgb(0_0_0/0.22)]"
      style={{ background: TAPAS[orden % TAPAS.length], borderRadius: '6px 16px 16px 6px', ...(alto ? { height: alto } : { aspectRatio: '3 / 4' }) }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[18px] bg-black/20" style={{ borderRadius: '6px 0 0 6px' }} />
      <span aria-hidden="true" className="absolute inset-y-0 right-7 w-2.5 bg-black/35" />
      <span
        className="relative flex w-[70%] flex-col gap-0.5 bg-white px-2.5 py-3.5 text-center text-tinta"
        style={{ borderRadius: 6, backgroundImage: 'linear-gradient(var(--color-punto) 1px, transparent 1px)', backgroundSize: '100% 24px' }}
      >
        <span className="font-manuscrita text-[26px] leading-none font-bold">{nombre}</span>
        {especialidad && <span className="text-xs font-bold">{especialidad}</span>}
      </span>
      {sello && (
        <span
          className="absolute bottom-3 left-5 flex size-[76px] -rotate-12 flex-col items-center justify-center border-[3px] border-white bg-black/40 text-center text-[10px] leading-[1.1] font-extrabold text-white"
          style={{ borderRadius: 999 }}
        >
          {sello}
        </span>
      )}
    </span>
  );
}
