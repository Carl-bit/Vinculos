import type { Metadata } from 'next';
import { Suspense } from 'react';

import { DescargaDocumento } from '@/components/pacientes/DescargaDocumento';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Descargar documento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Pagina() {
  return (
    <Suspense>
      <DescargaDocumento />
    </Suspense>
  );
}
