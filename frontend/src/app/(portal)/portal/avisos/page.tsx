import type { Metadata } from 'next';

import { AvisosPortal } from '@/components/nucleo/AvisosPortal';
import { Encabezado } from '@/components/shared/Encabezado';

export const metadata: Metadata = { title: 'Avisos' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Avisos" bajada="Lo que el centro te comunicó y qué avisos quieres recibir también por correo." />
      <AvisosPortal />
    </>
  );
}
