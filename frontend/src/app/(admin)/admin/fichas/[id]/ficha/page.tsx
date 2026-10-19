'use client';

import { Suspense, use } from 'react';

import { FichaClinica } from '@/components/pacientes/FichaClinica';
import { useSesion } from '@/lib/consultas';

export default function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  return (
    <Suspense>
      <FichaClinica pacienteId={id} rol={sesion.sesion.rol} />
    </Suspense>
  );
}
