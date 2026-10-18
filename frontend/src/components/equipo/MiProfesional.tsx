'use client';

import { useQuery } from '@tanstack/react-query';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { usePortal } from '@/components/shared/ContextoPortal';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { nombresDe, useEquipoPortal } from '@/lib/portal';

/**
 * "Mi profesional" del diseño: tratante actual, con foto y especialidad si
 * tiene perfil publico. "Enviar un mensaje" lleva a la seccion de mensajes.
 */
export function MiProfesional() {
  const portal = usePortal();
  const equipo = useEquipoPortal();
  const perfiles = useQuery({ queryKey: ['publico', 'profesionales'], queryFn: () => datos(api.GET('/api/publico/profesionales')), staleTime: 10 * 60_000 });
  const tratanteId = portal.paciente?.profesionalId ?? undefined;
  const nombre = tratanteId ? nombresDe(equipo.data).get(tratanteId) : undefined;
  const perfil = perfiles.data?.find((p) => p.id === tratanteId);

  if (portal.cargando || equipo.isPending) {
    return (
      <Panel variante="paciente" titulo="Mi profesional">
        <span aria-hidden="true" className="esqueleto block h-[70px] w-full rounded-lg" />
      </Panel>
    );
  }
  if (!tratanteId || !nombre) {
    return (
      <Panel
        variante="paciente"
        titulo="Mi profesional"
        bajada="Todavía no tienes un profesional asignado. Puedes pedir tu primera hora o hacer el match terapéutico."
      >
        <ButtonLink href="/portal/pedir-hora" variant="team" icon="calendar_month">
          Pedir una hora
        </ButtonLink>
      </Panel>
    );
  }
  return (
    <section className="rounded-lg border border-accent-2-500 bg-accent-2-200 px-[clamp(20px,3vw,28px)] py-[26px] shadow-sm">
      <h2 className="m-0 mb-4 text-[11px] font-extrabold tracking-[0.1em] text-accent-2-800 uppercase">
        {portal.responsable ? 'Su profesional' : 'Mi profesional'}
      </h2>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <AvatarProfesional nombre={perfil?.nombre_publico ?? nombre} foto={perfil?.foto_url ?? null} size={70} />
        <div className="min-w-0 flex-[1_1_180px]">
          <p className="m-0 text-[21px] font-black tracking-[-0.03em] text-accent-2-900">{perfil?.nombre_publico ?? nombre}</p>
          {perfil && <p className="m-0 text-[13.5px] font-bold text-accent-2-800">{perfil.especialidad}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-[11px]">
        <ButtonLink href="/portal/pedir-hora" variant="team" size="lg" icon="calendar_month" className="!py-3.5 !text-[14.5px]">
          Pedir una hora
        </ButtonLink>
        <ButtonLink href="#mensajes" variant="outlinePatient" size="lg" icon="send" className="!bg-bg !py-3.5 !text-[14.5px]">
          Enviar un mensaje
        </ButtonLink>
      </div>
    </section>
  );
}
