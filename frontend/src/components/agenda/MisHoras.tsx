'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { PagoCitaPortal } from '@/components/shared/PagoCitaPortal';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { Pestanas } from '@/components/ui/Pestanas';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora, formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { estadoCitaPortal, nombresDe, useCitasPortal, useEquipoPortal, useResenasPortal, type CitaPortal } from '@/lib/portal';

type Filtro = 'futura' | 'pasada' | 'todas';

const icono = (c: CitaPortal, pasada: boolean): Icono =>
  c.estado === 'CANCELADA'
    ? 'event_busy'
    : pasada
      ? 'history'
      : c.modalidad === 'ONLINE'
        ? 'videocam'
        : c.estado === 'PENDIENTE_PAGO'
          ? 'schedule'
          : 'event_available';

/**
 * "Mis horas" del diseño: proximas, pasadas o todas (solo datos
 * administrativos). Una reseña por profesional (D-1): bajo la ultima sesion
 * realizada con alguien que todavia no calificaste aparece "Calificar". Las
 * citas online muestran su enlace de videollamada.
 */
export function MisHoras({ limite }: { limite?: number }) {
  const portal = usePortal();
  const [filtro, setFiltro] = useState<Filtro>('futura');
  const panel = useId();
  const citas = useCitasPortal(portal.pacienteParam, true, !portal.cargando && !!portal.pacienteId);
  const equipo = useEquipoPortal();
  const resenas = useResenasPortal();
  const centro = useQuery({ queryKey: ['publico', 'centro'], queryFn: () => datos(api.GET('/api/publico/centro')), staleTime: 10 * 60_000 });
  const nombres = nombresDe(equipo.data);
  const ahora = Date.now();
  const delPaciente = (citas.data ?? []).filter((c) => !portal.pacienteId || c.pacienteId === portal.pacienteId);
  const futuras = delPaciente.filter((c) => new Date(c.fin).getTime() > ahora).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const pasadas = delPaciente.filter((c) => new Date(c.fin).getTime() <= ahora);
  const lista = filtro === 'futura' ? futuras : filtro === 'pasada' ? pasadas : [...futuras, ...pasadas];
  const calificados = new Set((resenas.data ?? []).filter((r) => r.estado !== 'RETIRADA').map((r) => r.profesionalId));
  // La reseña se invita bajo la sesion realizada mas reciente con cada profesional aun no calificado.
  const invitar = new Set<string>();
  const vistos = new Set<string>();
  for (const c of pasadas) {
    if (c.realizada && !vistos.has(c.profesionalId)) {
      vistos.add(c.profesionalId);
      if (!calificados.has(c.profesionalId)) invitar.add(c.id);
    }
  }
  const plazo = centro.data?.plazo_aviso_cancelacion_horas;
  const puedeResenar = !portal.restringida;
  const visibles = limite ? lista.slice(0, limite) : lista;

  return (
    <Panel
      id="horas"
      titulo="Mis horas"
      bajada={`Todas tus sesiones, pasadas y futuras. Para cambiar o cancelar una hora, avísale a tu profesional${plazo ? ` con ${plazo} horas de anticipación` : ' con anticipación'}.`}
    >
      <div className="mb-[18px]">
        <Pestanas
          etiqueta="Filtrar horas"
          panelId={panel}
          valor={filtro}
          onChange={setFiltro}
          pestanas={[
            { valor: 'futura', etiqueta: `Próximas (${futuras.length})` },
            { valor: 'pasada', etiqueta: `Pasadas (${pasadas.length})` },
            { valor: 'todas', etiqueta: 'Todas' },
          ]}
        />
      </div>
      <div id={panel} role="tabpanel">
        <EstadoConsulta
          consulta={citas}
          vacio={() => lista.length === 0}
          textoVacio={filtro === 'futura' ? 'No tienes horas agendadas' : 'Todavía no hay horas en tu historial'}
          accionVacio={
            filtro === 'futura' ? (
              <ButtonLink href="/portal/pedir-hora" variant="secondary" icon="calendar_month">
                Pedir una hora
              </ButtonLink>
            ) : undefined
          }
        >
          {() => (
            <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
              {visibles.map((c) => {
                const pasada = new Date(c.fin).getTime() <= ahora;
                const estado = estadoCitaPortal(c);
                const profesional = nombres.get(c.profesionalId) ?? 'Profesional del centro';
                const modalidad = c.modalidad === 'ONLINE' ? 'Online' : c.espacioNombre ? `Presencial, ${c.espacioNombre}` : 'Presencial';
                const invita = puedeResenar && invitar.has(c.id);
                return (
                  <li key={c.id} className={`rounded-[18px] border bg-bg px-[18px] py-4 ${invita ? 'border-accent-500' : 'border-divider'}`}>
                    <div className="flex flex-wrap items-center gap-3.5">
                      <span
                        className={`grid size-10 flex-none place-items-center rounded-full border ${
                          pasada ? 'border-neutral-400 bg-neutral-200 text-neutral-700' : 'border-accent-2-500 bg-accent-2-200 text-accent-2-700'
                        }`}
                      >
                        <Icon name={icono(c, pasada)} size={20} />
                      </span>
                      <div className="min-w-0 flex-[1_1_170px]">
                        <p className="m-0 text-[14.5px] font-black tracking-[-0.015em] first-letter:uppercase">{formatoFechaLarga(c.inicio)}</p>
                        <p className="m-0 text-[13px] font-semibold text-neutral-700">
                          {formatoHora(c.inicio)} · {modalidad} · {profesional}
                        </p>
                      </div>
                      <Badge tono={estado.tono}>{estado.texto}</Badge>
                    </div>
                    {!pasada && c.modalidad === 'ONLINE' && c.estado === 'CONFIRMADA' && <EnlaceVideollamada citaId={c.id} />}
                    {c.estado === 'PENDIENTE_PAGO' && !pasada && !portal.restringida && <PagoPendiente cita={c} />}
                    {invita && (
                      <div className="mt-3.5 flex flex-wrap items-center gap-[13px] border-t border-divider pt-3.5">
                        <span className="flex-[1_1_150px] text-[12.5px] font-bold text-pretty text-neutral-700">
                          Aún no has calificado a {profesional}. Tu calificación es anónima salvo que elijas lo contrario.
                        </span>
                        <ButtonLink href={`/portal/resenas?profesional=${c.profesionalId}`} variant="team" icon="star" className="!px-[18px] !text-[13px]">
                          Calificar
                        </ButtonLink>
                      </div>
                    )}
                    {puedeResenar && c.realizada && !invita && calificados.has(c.profesionalId) && (
                      <p className="m-0 mt-3 flex items-center gap-2 text-[12.5px] font-bold text-accent-2-800">
                        <Icon name="task_alt" size={16} />
                        Ya calificaste a {profesional}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
        {limite && lista.length > limite && (
          <p className="m-0 mt-3 text-[13px] font-bold text-neutral-700">
            Mostrando {limite} de {lista.length}.
          </p>
        )}
      </div>
      <div className="mt-[18px] border-t border-divider pt-[18px]">
        <Aviso tono="nota" className="!border-0 !bg-transparent !p-0">
          Este historial muestra solo la información administrativa de tus horas. No incluye el contenido de las sesiones.
        </Aviso>
      </div>
    </Panel>
  );
}

/** El enlace se pide al tocar (vence al terminar la cita); nunca queda guardado en el navegador. */
function EnlaceVideollamada({ citaId }: { citaId: string }) {
  const [estado, setEstado] = useState<{ url?: string; error?: string; cargando?: boolean }>({});
  const pedir = async () => {
    setEstado({ cargando: true });
    try {
      const r = await datos(api.GET('/api/citas/{id}/enlace', { params: { path: { id: citaId } } }));
      setEstado({ url: r.url });
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setEstado({
        error:
          e instanceof ApiError && e.status === 404
            ? 'Tu profesional todavía no comparte el enlace. Te llegará por correo antes de la sesión.'
            : e instanceof ApiError
              ? e.message
              : 'No pudimos obtener el enlace.',
      });
    }
  };
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-3 border-t border-divider pt-3.5">
      <Button variant="secondary" icon="videocam" loading={estado.cargando} onClick={() => void pedir()} className="!py-2.5">
        Entrar a la videollamada
      </Button>
      {estado.url && (
        <a href={estado.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-bold">
          Abrir de nuevo
        </a>
      )}
      {estado.error && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {estado.error}
        </p>
      )}
    </div>
  );
}

/** 03b-3.1: cita pendiente de pago: plazo visible y el paso de pago (medio, datos para transferir, comprobante). */
function PagoPendiente({ cita }: { cita: CitaPortal }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="mt-3.5 flex flex-col gap-3 border-t border-divider pt-3.5">
      <div className="flex flex-wrap items-center gap-[13px]">
        <span className="flex-[1_1_180px] text-[12.5px] font-bold text-pretty text-accent-800">
          Falta el pago para confirmar.
          {cita.pagoVenceEn &&
            (cita.agendadaPorEquipo
              ? ` Plazo para pagar en línea: ${formatoFechaHora(cita.pagoVenceEn)}; después se paga en el centro el día de la atención.`
              : ` Plazo: ${formatoFechaHora(cita.pagoVenceEn)}; después la hora se libera.`)}
        </span>
        <Button variant="team" icon="payments" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)} className="!px-[18px] !text-[13px]">
          {abierto ? 'Ocultar' : 'Pagar o subir comprobante'}
        </Button>
      </div>
      {abierto && <PagoCitaPortal citaId={cita.id} agendadaPorEquipo={cita.agendadaPorEquipo} />}
    </div>
  );
}
