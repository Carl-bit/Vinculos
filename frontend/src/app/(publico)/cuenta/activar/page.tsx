import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ActivarCuenta } from '@/components/nucleo/ActivarCuenta';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Activar cuenta', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Pagina() {
  return (
    <div className="flex justify-center py-[clamp(16px,3vw,40px)]">
      <Suspense>
        <ActivarCuenta />
      </Suspense>
    </div>
  );
}
