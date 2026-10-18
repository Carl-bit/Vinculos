import type { Metadata } from 'next';

import { MisHoras } from '@/components/agenda/MisHoras';
import { MiProfesional } from '@/components/equipo/MiProfesional';
import { MensajeProfesional } from '@/components/pacientes/MensajeProfesional';
import { MisDatos } from '@/components/pacientes/MisDatos';
import { NotaFicha } from '@/components/pacientes/NotaFicha';
import { SaludoPortal } from '@/components/shared/SaludoPortal';

export const metadata: Metadata = { title: 'Mi cuenta' };

/** Inicio del portal (diseño "Paciente - Mi Cuenta"): profesional, horas, mensajes y datos. */
export default function InicioPortal() {
  return (
    <>
      <SaludoPortal />
      <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
        <div className="flex min-w-0 flex-col gap-[18px]">
          <MiProfesional />
          <MisHoras />
          <MensajeProfesional />
        </div>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <MisDatos />
          <NotaFicha />
        </div>
      </div>
    </>
  );
}
