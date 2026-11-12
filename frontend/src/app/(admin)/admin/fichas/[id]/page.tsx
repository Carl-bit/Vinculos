'use client';

import { Suspense, use } from 'react';

import { DetallePaciente } from '@/components/pacientes/DetallePaciente';
import { FichasProfesional } from '@/components/pacientes/FichasProfesional';
import { EstadoVista } from '@/components/shared/EstadoVista';
import { useSesion } from '@/lib/consultas';

/** Ficha de un paciente: el profesional y el practicante la ven junto a su riel "Mis pacientes"; administracion, sola. */
export default function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  const rol = sesion.sesion.rol;
  // Punto 20: la cuenta madre no abre el perfil del paciente (solo el seguimiento con su profesional).
  if (rol === 'ADMIN')
    return (
      <EstadoVista
        estado="sin-permiso"
        titulo="La cuenta madre no abre perfiles de pacientes"
        mensaje="Sigue el trabajo de cada profesional en Fichas y pacientes > Seguimiento. Los datos del paciente los gestiona recepción o su profesional."
      />
    );
  return (
    <Suspense>
      {rol === 'PROFESIONAL' || rol === 'PRACTICANTE' ? <FichasProfesional rol={rol} seleccionado={id} /> : <DetallePaciente id={id} rol={rol} />}
    </Suspense>
  );
}
