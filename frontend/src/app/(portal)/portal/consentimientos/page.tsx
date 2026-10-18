import type { Metadata } from 'next';

import { ConsentimientosPortal } from '@/components/pacientes/ConsentimientosPortal';
import { Encabezado } from '@/components/shared/Encabezado';
import { SoloCuentaPlena } from '@/components/shared/SoloCuentaPlena';

export const metadata: Metadata = { title: 'Consentimientos' };

export default function Pagina() {
  return (
    <>
      <Encabezado
        titulo="Consentimientos"
        bajada="Lo que aceptaste para tu atención y lo que está pendiente de responder. Antes de cada respuesta te explicamos qué pasa."
      />
      <SoloCuentaPlena>
        <ConsentimientosPortal />
      </SoloCuentaPlena>
    </>
  );
}
