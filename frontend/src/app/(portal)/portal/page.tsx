import type { Metadata } from 'next';

import { MisHoras } from '@/components/agenda/MisHoras';
import { MiProfesional } from '@/components/equipo/MiProfesional';
import { ResumenContactosPortal } from '@/components/pacientes/ContactosEmergenciaPortal';
import { MensajeProfesional } from '@/components/pacientes/MensajeProfesional';
import { UltimosAvisos } from '@/components/nucleo/AvisosPortal';
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
      <div className="grid items-start gap-x-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
        <SaludoPortal />
        {/* Misma altura que el sobretitulo "Mi cuenta" (el padding superior del encabezado), separado de la barra de secciones. */}
        <div className="pt-[clamp(16px,3vw,32px)] pb-[26px]">
          <MiProfesional />
        </div>
      </div>
      <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
        <MisHoras />
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Arriba a la derecha: acceso rapido a escribirle al profesional (pedido 2026-11-06). */}
          {/* Punto 38: si tiene contacto de emergencia (sin sus datos); se ve y modifica en Seguridad. */}
          <ResumenContactosPortal />
          <MensajeProfesional />
          {/* Punto 44: los ultimos avisos (todos en un popup) en vez de la nota de la ficha. */}
          <UltimosAvisos />
        </div>
      </div>
    </>
  );
}
