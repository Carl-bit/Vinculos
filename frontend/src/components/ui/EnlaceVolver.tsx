import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from './Icon';

/** "← Volver" del diseño (texto neutro, flecha, sin borde). */
export function EnlaceVolver({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-5 inline-flex min-h-10 items-center gap-2 text-[13.5px] font-extrabold text-neutral-800 hover:text-accent-700">
      <Icon name="arrow_back" />
      {children}
    </Link>
  );
}
