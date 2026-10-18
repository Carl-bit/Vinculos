'use client';

import { Suspense, use } from 'react';

import { DetallePaciente } from '@/components/pacientes/DetallePaciente';
import { useSesion } from '@/lib/consultas';

export default function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  return (
    <Suspense>
      <DetallePaciente id={id} rol={sesion.sesion.rol} />
    </Suspense>
  );
}
