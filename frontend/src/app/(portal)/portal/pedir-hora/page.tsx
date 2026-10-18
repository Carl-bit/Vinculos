import type { Metadata } from 'next';

import { PedirHoraPortal } from '@/components/agenda/PedirHoraPortal';
import { Encabezado } from '@/components/shared/Encabezado';

export const metadata: Metadata = { title: 'Pedir una hora' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Pedir una hora" bajada="Elige una hora con tu profesional, sin volver a escribir tus datos." />
      <PedirHoraPortal />
    </>
  );
}
