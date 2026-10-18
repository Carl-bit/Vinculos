import type { Metadata } from 'next';

import { PagosPortal } from '@/components/cobros/PagosPortal';
import { Encabezado } from '@/components/shared/Encabezado';
import { SoloCuentaPlena } from '@/components/shared/SoloCuentaPlena';

export const metadata: Metadata = { title: 'Pagos' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Pagos" bajada="Lo que corresponde pagar por cada sesión, lo pagado y tus boletas." />
      <SoloCuentaPlena>
        <PagosPortal />
      </SoloCuentaPlena>
    </>
  );
}
