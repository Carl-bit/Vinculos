import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Tile de estadistica del diseño (Dashboard): etiqueta en mayusculas, numero
 * grande en 900 y nota. Con `href`, todo el tile lleva a la seccion.
 */
export function Estadistica({
  etiqueta,
  valor,
  nota,
  notaTono = 'neutra',
  href,
}: {
  etiqueta: string;
  valor: ReactNode;
  nota?: ReactNode;
  notaTono?: 'neutra' | 'atencion' | 'positiva';
  href?: string;
}) {
  const color = notaTono === 'atencion' ? 'text-accent-700' : notaTono === 'positiva' ? 'text-accent-2-700' : 'text-neutral-700';
  const cuerpo = (
    <>
      <span className="text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">{etiqueta}</span>
      <span className="text-[40px] leading-[0.95] font-black tracking-[-0.04em] tabular-nums">{valor}</span>
      {nota && <span className={`text-[12.5px] font-bold ${color}`}>{nota}</span>}
    </>
  );
  const clases =
    'flex flex-col gap-3 rounded-lg border border-divider bg-bg px-[22px] py-5 text-text shadow-sm transition-shadow duration-200 ease-out hover:shadow-lg';
  return href ? (
    <Link href={href} className={`${clases} hover:text-text`}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clases}>{cuerpo}</div>
  );
}
