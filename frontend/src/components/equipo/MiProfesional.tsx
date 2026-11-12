'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { usePortal } from '@/components/shared/ContextoPortal';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';
import { nombresDe, useEquipoPortal } from '@/lib/portal';

/**
 * "Mi profesional" del diseño: tratante actual, con foto y especialidad si
 * tiene perfil publico. Correcciones 2026-11-11: si el tratante no puede
 * atender (desactivado, de baja o con un bloqueo vigente) no se ofrece pedir
 * hora ni escribirle: se avisa y se ofrece atenderse con otro profesional o
 * cancelar las horas que tenia con el. Si lo atiende un reemplazo (atencion
 * temporal), la nueva hora es con el reemplazo, o puede pedir otro del equipo.
 */
export function MiProfesional() {
  const portal = usePortal();
  const equipo = useEquipoPortal();
  const cliente = useQueryClient();
  const perfiles = useQuery({ queryKey: ['publico', 'profesionales'], queryFn: () => datos(api.GET('/api/publico/profesionales')), staleTime: 10 * 60_000 });
  const tratanteId = portal.paciente?.profesionalId ?? undefined;
  const estado = useQuery({
    queryKey: ['portal', 'estado-tratante', portal.pacienteParam ?? 'propio'],
    queryFn: () => datos(api.GET('/api/portal/estado-tratante', { params: { query: { pacienteId: portal.pacienteParam } } })),
    enabled: !portal.cargando && !!tratanteId,
  });
  const nombres = nombresDe(equipo.data);
  const nombre = tratanteId ? nombres.get(tratanteId) : undefined;
  const perfil = perfiles.data?.find((p) => p.id === tratanteId);
  const [hecho, setHecho] = useState<string>();
  const refrescar = () => {
    void cliente.invalidateQueries({ queryKey: ['portal', 'estado-tratante'] });
    void cliente.invalidateQueries({ queryKey: ['portal', 'citas'] });
  };
  const otro = useMutation({
    mutationFn: () => datos(api.POST('/api/portal/otro-profesional', { body: { pacienteId: portal.pacienteParam } })),
    onSuccess: () => {
      setHecho('Listo: el centro te asignará otro profesional y te avisará.');
      refrescar();
    },
  });
  const cancelar = useMutation({
    mutationFn: () => datos(api.POST('/api/portal/horas-tratante/cancelacion', { body: { pacienteId: portal.pacienteParam } })),
    onSuccess: (r) => {
      setHecho(r.canceladas === 1 ? 'Cancelamos 1 hora.' : `Cancelamos ${r.canceladas} horas.`);
      refrescar();
    },
  });
  const error = otro.error ?? cancelar.error;

  if (portal.cargando || equipo.isPending || (tratanteId && estado.isPending)) {
    return (
      <Panel variante="paciente" titulo="Mi profesional">
        <span aria-hidden="true" className="esqueleto block h-[70px] w-full rounded-lg" />
      </Panel>
    );
  }
  // Un tratante desactivado puede no venir en el equipo del portal: igual cae en "no disponible" (abajo), no en "sin profesional".
  if (!tratanteId || (!nombre && estado.data?.disponible !== false)) {
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

  const e = estado.data;
  const titulo = portal.responsable ? 'Su profesional' : 'Mi profesional';
  const avisos = (
    <>
      {hecho && (
        <p role="status" className="m-0 mt-3 text-[13px] font-bold text-accent-2-900">
          {hecho}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-800">
          {error instanceof ApiError ? error.message : 'No pudimos completar la acción.'}
        </p>
      )}
    </>
  );

  // Tratante no disponible: ni su nombre ni pedir hora o escribirle; opciones para seguir atendiéndose.
  if (e && !e.disponible) {
    return (
      <section className="rounded-lg border border-pendiente-100 bg-pendiente-100 px-[clamp(20px,3vw,28px)] py-[26px] shadow-sm">
        <h2 className="m-0 mb-3 text-[11px] font-extrabold tracking-[0.1em] text-pendiente-900 uppercase">{titulo}</h2>
        <p className="m-0 text-[19px] font-black tracking-[-0.02em] text-pendiente-900">Tu profesional no estará disponible por unos días.</p>
        <p className="m-0 mt-1 text-[14px] font-semibold text-pendiente-900">
          Lamentamos el inconveniente.{e.vuelveEn ? ` Vuelve a atender el ${formatoFechaLarga(e.vuelveEn)}.` : ''}
        </p>
        {e.solicitudPendiente ? (
          <p className="m-0 mt-4 text-[13.5px] font-bold text-pendiente-900">Ya pediste otro profesional: el centro te contactará para asignarlo.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2.5">
            <p className="m-0 text-[13.5px] font-bold text-pendiente-900">
              {e.horasConTratante > 0
                ? `Tienes ${e.horasConTratante === 1 ? 'una hora agendada' : `${e.horasConTratante} horas agendadas`} con tu profesional. ¿Qué prefieres?`
                : '¿Necesitas una sesión mientras tanto?'}
            </p>
            <div className="flex flex-wrap gap-[11px]">
              <Button variant="team" icon="swap_horiz" loading={otro.isPending} onClick={() => otro.mutate()} className="!py-3 !text-[14px]">
                {e.horasConTratante > 0 ? 'Atenderme con otro profesional' : 'Pedir otro profesional del equipo'}
              </Button>
              {e.horasConTratante > 0 && (
                <Button
                  variant="secondary"
                  icon="event_busy"
                  loading={cancelar.isPending}
                  onClick={() => cancelar.mutate()}
                  className="!bg-bg !py-3 !text-[14px]"
                >
                  Cancelar mis horas
                </Button>
              )}
            </div>
          </div>
        )}
        {avisos}
      </section>
    );
  }

  const principal = e?.principalId ? (nombres.get(e.principalId) ?? 'tu profesional principal') : null;
  return (
    <section className="rounded-lg border border-accent-2-500 bg-accent-2-200 px-[clamp(20px,3vw,28px)] py-[26px] shadow-sm">
      <h2 className="m-0 mb-4 text-[11px] font-extrabold tracking-[0.1em] text-accent-2-800 uppercase">{titulo}</h2>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <AvatarProfesional nombre={perfil?.nombre_publico ?? nombre ?? 'Profesional'} foto={perfil?.foto_url ?? null} size={70} />
        <div className="min-w-0 flex-[1_1_180px]">
          <p className="m-0 text-[21px] font-black tracking-[-0.03em] text-accent-2-900">{perfil?.nombre_publico ?? nombre}</p>
          {perfil && <p className="m-0 text-[13.5px] font-bold text-accent-2-800">{perfil.especialidad}</p>}
          {principal && <p className="m-0 mt-1 text-[13px] font-semibold text-accent-2-900">Te atiende mientras {principal} no está disponible.</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-[11px]">
        <ButtonLink href="/portal/pedir-hora" variant="team" size="lg" icon="calendar_month" className="!py-3.5 !text-[14.5px]">
          Pedir una hora
        </ButtonLink>
        <ButtonLink href="#mensajes" variant="outlinePatient" size="lg" icon="send" className="!bg-bg !py-3.5 !text-[14.5px]">
          Enviar un mensaje
        </ButtonLink>
        {principal && !e?.solicitudPendiente && (
          <Button variant="ghost" icon="swap_horiz" loading={otro.isPending} onClick={() => otro.mutate()} className="!py-3.5 !text-[13.5px]">
            Prefiero otro profesional
          </Button>
        )}
      </div>
      {avisos}
    </section>
  );
}
