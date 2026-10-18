'use client';

import { InicioPanel } from '@/components/nucleo/InicioPanel';
import { NuevoPaciente } from '@/components/pacientes/NuevoPaciente';
import { Bienvenida } from '@/components/shared/Bienvenida';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { useModulos, useSesion } from '@/lib/consultas';

/** Inicio del backoffice (diseño "Admin - Dashboard"): saludo, acciones rapidas y panel del rol activo. */
export default function InicioAdmin() {
  const sesion = useSesion();
  const activos = useModulos().data?.activos ?? [];
  if (sesion.tipo !== 'activa') return null;
  const rol = sesion.sesion.rol;
  const clinico = rol !== 'PRACTICANTE';
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Bienvenida tone="team" />
        <div className="mb-[30px] flex flex-wrap gap-2.5">
          {clinico && activos.includes('FICHAS') && <NuevoPaciente rol={rol} />}
          {activos.includes('AGENDA') && (
            <ButtonLink href="/admin/agenda?nueva=1" variant="primary" icon="event">
              Agendar sesión
            </ButtonLink>
          )}
        </div>
      </div>
      <InicioPanel rol={rol} />
    </>
  );
}
