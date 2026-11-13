import type { Metadata } from 'next';

import { MensajeProfesional, RespuestasProfesional } from '@/components/pacientes/MensajeProfesional';
import { Encabezado } from '@/components/shared/Encabezado';

export const metadata: Metadata = { title: 'Mensajes' };

export default function Pagina() {
  return (
    <>
      {/* Punto 44: conversacion con tu profesional; la configuracion de avisos por correo vive en Seguridad (la cambia el paciente). */}
      <Encabezado titulo="Mensajes" bajada="Habla con tu profesional por aquí. Qué avisos te llegan por correo se elige en Seguridad." />
      <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
        <MensajeProfesional vista="mensajes" />
        <RespuestasProfesional />
      </div>
    </>
  );
}
