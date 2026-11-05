'use client';

import { Suspense, use } from 'react';

import { DetallePaciente } from '@/components/pacientes/DetallePaciente';
import { FichasProfesional } from '@/components/pacientes/FichasProfesional';
import { useSesion } from '@/lib/consultas';

/** Ficha de un paciente: el profesional y el practicante la ven junto a su riel "Mis pacientes"; administracion, sola. */
export default function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  const rol = sesion.sesion.rol;
  return (
    <Suspense>
      {rol === 'PROFESIONAL' || rol === 'PRACTICANTE' ? <FichasProfesional rol={rol} seleccionado={id} /> : <DetallePaciente id={id} rol={rol} />}
    </Suspense>
  );
}
