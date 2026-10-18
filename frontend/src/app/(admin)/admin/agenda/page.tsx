'use client';

import { Suspense } from 'react';

import { AgendaEspacios } from '@/components/agenda/AgendaEspacios';
import { useSesion } from '@/lib/consultas';

/** Agenda y Espacios: calendario, boxes, horarios del equipo y pendientes. */
function Agenda() {
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  return <AgendaEspacios rol={sesion.sesion.rol} />;
}

export default function Pagina() {
  return (
    <Suspense>
      <Agenda />
    </Suspense>
  );
}
