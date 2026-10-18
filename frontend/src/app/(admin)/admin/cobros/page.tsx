'use client';

import { Suspense } from 'react';

import { CobrosCentro } from '@/components/cobros/CobrosCentro';
import { useSesion } from '@/lib/consultas';

/** Cobros: resumen del periodo, asistencia y pago, y liquidaciones. */
function Cobros() {
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  return <CobrosCentro rol={sesion.sesion.rol} />;
}

export default function Pagina() {
  return (
    <Suspense>
      <Cobros />
    </Suspense>
  );
}
