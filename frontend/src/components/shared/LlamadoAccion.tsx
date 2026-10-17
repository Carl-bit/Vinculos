import type { ReactNode } from 'react';

/** Bloque verde de llamado a la accion (pie de Landing y Equipo): titulo, texto, acciones y un lateral opcional. */
export function LlamadoAccion({
  id,
  titulo,
  texto,
  acciones,
  lateral,
}: {
  id?: string;
  titulo: string;
  texto: ReactNode;
  acciones: ReactNode;
  lateral?: ReactNode;
}) {
  return (
    <section
      id={id}
      className="revelar mt-[clamp(30px,5vw,64px)] flex scroll-mt-6 flex-wrap items-center justify-between gap-8 rounded-lg border border-accent-2-500 bg-accent-2-200 p-[clamp(28px,4vw,54px)] shadow-md"
    >
      <div className="min-w-0 flex-[1_1_300px]">
        <h2 className="m-0 mb-2.5 text-[clamp(25px,3vw,36px)] leading-[1.05] font-black tracking-[-0.03em] text-balance">{titulo}</h2>
        <p className="m-0 mb-5 max-w-[52ch] text-base font-semibold text-pretty text-accent-2-900">{texto}</p>
        <div className="flex flex-wrap gap-3">{acciones}</div>
      </div>
      {lateral}
    </section>
  );
}
