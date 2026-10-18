import type { Metadata } from 'next';

import { ListaEsperaPortal } from '@/components/agenda/ListaEsperaPortal';
import { Encabezado } from '@/components/shared/Encabezado';

export const metadata: Metadata = { title: 'Lista de espera' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Lista de espera" bajada="Te avisamos cuando se libera una hora con el profesional que elegiste." />
      <ListaEsperaPortal />
    </>
  );
}
