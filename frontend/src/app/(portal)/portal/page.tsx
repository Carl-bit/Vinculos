import type { Metadata } from 'next';

import { MisHoras } from '@/components/agenda/MisHoras';
import { MiProfesional } from '@/components/equipo/MiProfesional';
import { MensajeProfesional } from '@/components/pacientes/MensajeProfesional';
import { NotaFicha } from '@/components/pacientes/NotaFicha';
import { SaludoPortal } from '@/components/shared/SaludoPortal';

export const metadata: Metadata = { title: 'Mi cuenta' };

/**
 * Inicio del portal (diseño "Paciente - Mi Cuenta"). Punto 42: "Mi profesional"
 * al lado del saludo; los datos del paciente van en su tarjeta junto a las
 * secciones (LayoutPortal).
 */
export default function InicioPortal() {
  return (
    <>
      <div className="grid items-center gap-x-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
        <SaludoPortal />
        <div className="pb-[26px]">
          <MiProfesional />
        </div>
      </div>
      <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
        <MisHoras />
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Arriba a la derecha: acceso rapido a escribirle al profesional (pedido 2026-11-06). */}
          <MensajeProfesional />
          <NotaFicha />
        </div>
      </div>
    </>
  );
}
