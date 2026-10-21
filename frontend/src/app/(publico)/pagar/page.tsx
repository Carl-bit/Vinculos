import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PagoPorEnlace } from '@/components/cobros/PagoPorEnlace';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Pago de tu sesión', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Pagina() {
  return (
    <Suspense>
      <PagoPorEnlace />
    </Suspense>
  );
}
