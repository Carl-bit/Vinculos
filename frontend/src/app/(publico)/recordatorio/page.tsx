import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RecordatorioEnlace } from '@/components/agenda/RecordatorioEnlace';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Recordatorio de tu hora', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Pagina() {
  return (
    <Suspense>
      <RecordatorioEnlace />
    </Suspense>
  );
}
