import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VerificarSolicitud } from '@/components/agenda/VerificarSolicitud';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Confirmar hora', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Verificar() {
  return (
    <Suspense>
      <VerificarSolicitud />
    </Suspense>
  );
}
