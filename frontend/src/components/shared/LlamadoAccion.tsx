import type { ReactNode } from 'react';

const TONOS = {
  verde: { caja: 'rounded-lg border border-accent-2-500 bg-accent-2-200 shadow-md', texto: 'text-accent-2-900' },
  /** Moderno (pie de la Landing): bloque tinta con texto claro. */
  oscuro: { caja: 'llamado-oscuro rounded-panel bg-tinta text-neutral-100', texto: 'text-neutral-300' },
} as const;

/** Bloque de llamado a la accion (pie de Landing y Equipo): titulo, texto, acciones y un lateral opcional. */
export function LlamadoAccion({
  id,
  titulo,
  texto,
  acciones,
  lateral,
  tono = 'verde',
}: {
  id?: string;
  titulo: string;
  texto: ReactNode;
  acciones?: ReactNode;
  lateral?: ReactNode;
  tono?: keyof typeof TONOS;
}) {
  const t = TONOS[tono];
  return (
    <section
      id={id}
      className={`revelar mt-[clamp(30px,5vw,64px)] flex scroll-mt-24 flex-wrap items-center justify-between gap-8 p-[clamp(28px,4vw,54px)] ${t.caja}`}
    >
      <div className="min-w-0 flex-[999_1_300px]">
        <h2 className="m-0 mb-2.5 text-[clamp(25px,3vw,36px)] leading-[1.05] font-black tracking-[-0.03em] text-balance">{titulo}</h2>
        <p className={`m-0 max-w-[52ch] text-base font-semibold text-pretty ${t.texto}`}>{texto}</p>
        {acciones && <div className="mt-5 flex flex-wrap gap-3">{acciones}</div>}
      </div>
      {lateral}
    </section>
  );
}
