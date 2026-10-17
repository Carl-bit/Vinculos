import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EnlaceListaEspera } from '@/components/agenda/EnlaceListaEspera';

/** El token va en la URL: no se indexa ni se envia como Referer. */
export const metadata: Metadata = { title: 'Salir de la lista de espera', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Pagina() {
  return (
    <Suspense>
      <EnlaceListaEspera modo="baja" />
    </Suspense>
  );
}
