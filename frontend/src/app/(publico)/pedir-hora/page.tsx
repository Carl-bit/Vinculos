import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InicioPedirHora } from '@/components/agenda/InicioPedirHora';
import { centroPublico } from '@/lib/api/servidor';

export const metadata: Metadata = {
  title: 'Pedir una hora',
  description: 'Reserva una hora en línea con el profesional que prefieras, sin crear una cuenta antes.',
};

export default async function PedirHora() {
  const centro = await centroPublico();
  if (!centro?.modulos.includes('AGENDA')) notFound();
  return <InicioPedirHora match={centro.modulos.includes('MATCH')} />;
}
