'use client';

import { Suspense } from 'react';

import { EquipoCentro } from '@/components/equipo/EquipoCentro';
import { useSesion } from '@/lib/consultas';

/** Equipo: integrantes, practicantes, catalogos, reseñas y alertas. */
function Equipo() {
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  return <EquipoCentro rol={sesion.sesion.rol} />;
}

export default function Pagina() {
  return (
    <Suspense>
      <Equipo />
    </Suspense>
  );
}
