import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ConsentimientoEnlace } from '@/components/pacientes/ConsentimientoEnlace';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Consentimiento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Pagina() {
  return (
    <Suspense>
      <ConsentimientoEnlace />
    </Suspense>
  );
}
