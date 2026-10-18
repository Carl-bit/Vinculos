import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ResenasPortal } from '@/components/equipo/ResenasPortal';
import { Encabezado } from '@/components/shared/Encabezado';
import { SoloCuentaPlena } from '@/components/shared/SoloCuentaPlena';

export const metadata: Metadata = { title: 'Reseñas' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Reseñas" bajada="Califica la atención que recibiste. Es anónima salvo que elijas mostrar tu nombre." />
      <SoloCuentaPlena>
        <Suspense>
          <ResenasPortal />
        </Suspense>
      </SoloCuentaPlena>
    </>
  );
}
