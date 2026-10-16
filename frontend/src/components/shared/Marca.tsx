import Link from 'next/link';

export const NOMBRE_CENTRO = process.env.NEXT_PUBLIC_CENTRO_NOMBRE ?? 'Centro de Prueba';

/** Punto de color + nombre del centro (header publico, portal y sidebar). */
export function Marca({ href = '/', size = 'lg' }: { href?: string; size?: 'lg' | 'sm' }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-[9px] text-text hover:text-text">
      <span aria-hidden="true" className={`inline-block flex-none rounded-full bg-accent-2-600 ${size === 'lg' ? 'size-[11px]' : 'size-2.5'}`} />
      <span className={`truncate font-black tracking-[-0.04em] ${size === 'lg' ? 'text-xl' : 'text-[17px]'}`}>{NOMBRE_CENTRO}</span>
    </Link>
  );
}
