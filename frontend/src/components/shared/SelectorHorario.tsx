'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import { bloquesDeSesion, esManana, porDia, type Bloque, type ModalidadAtencion } from '@/lib/horarios';

/** Ventana de busqueda (la API acepta hasta 62 dias). */
const DIAS_VENTANA = 42;

const diaSemana = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', weekday: 'short' });
const diaMes = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric' });
const mes = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', month: 'short' });

export const NOMBRE_MODALIDAD_CITA: Record<ModalidadAtencion, string> = { PRESENCIAL: 'Presencial', ONLINE: 'Online' };

export const igual = (a: Bloque | null, b: Bloque) => !!a && a.modalidad === b.modalidad && a.inicio.getTime() === b.inicio.getTime();

/**
 * Horas disponibles del profesional (disponibilidad_publica: horario del
 * profesional y del centro, citas, bloqueos y retenciones vigentes). Elegir
 * no retiene: la retencion empieza al enviar la solicitud.
 */
export function SelectorHorario({
  profesionalId,
  valor,
  onElegir,
  sinHoras,
  portal,
  equipo,
}: {
  profesionalId: string;
  valor: Bloque | null;
  onElegir: (b: Bloque) => void;
  sinHoras: React.ReactNode;
  /** Portal del paciente: horas de su tratante con su sesion (aunque no tenga perfil publico). */
  portal?: { pacienteId: string | undefined };
  /** Backoffice: huecos del profesional con la sesion del equipo; polling de 15 s mientras se ve (estandar_polling.md). */
  equipo?: boolean;
}) {
  const consulta = useQuery({
    queryKey: equipo
      ? ['huecos', profesionalId]
      : portal
        ? ['disponibilidad-portal', profesionalId, portal.pacienteId ?? 'propio']
        : ['disponibilidad-publica', profesionalId],
    queryFn: () => {
      const desde = new Date();
      const hasta = new Date(desde.getTime() + DIAS_VENTANA * 86_400_000);
      const rango = { desde: desde.toISOString(), hasta: hasta.toISOString() };
      if (equipo) return datos(api.GET('/api/profesionales/{profesionalId}/huecos', { params: { path: { profesionalId }, query: rango } }));
      return portal
        ? datos(api.GET('/api/portal/disponibilidad', { params: { query: { ...rango, pacienteId: portal.pacienteId } } }))
        : datos(api.GET('/api/publico/profesionales/{id}/disponibilidad', { params: { path: { id: profesionalId }, query: rango } }));
    },
    staleTime: equipo ? 0 : 30_000,
    refetchInterval: equipo ? 15_000 : false,
  });

  return <EstadoConsulta consulta={consulta}>{(huecos) => <Grilla huecos={huecos} valor={valor} onElegir={onElegir} sinHoras={sinHoras} />}</EstadoConsulta>;
}

function Grilla({
  huecos,
  valor,
  onElegir,
  sinHoras,
}: {
  huecos: Parameters<typeof bloquesDeSesion>[0];
  valor: Bloque | null;
  onElegir: (b: Bloque) => void;
  sinHoras: React.ReactNode;
}) {
  const todos = useMemo(() => bloquesDeSesion(huecos), [huecos]);
  const modalidades = [...new Set(todos.map((b) => b.modalidad))].sort() as ModalidadAtencion[];
  const [modalidad, setModalidad] = useState<ModalidadAtencion | null>(valor?.modalidad ?? null);
  const activa = modalidad && modalidades.includes(modalidad) ? modalidad : (modalidades[0] ?? null);
  const dias = useMemo(() => porDia(todos.filter((b) => b.modalidad === activa)), [todos, activa]);
  const claves = [...dias.keys()];
  const [dia, setDia] = useState<string | null>(null);
  const diaActivo = dia && dias.has(dia) ? dia : (claves[0] ?? null);

  if (todos.length === 0) return <>{sinHoras}</>;
  const bloques = diaActivo ? dias.get(diaActivo)! : [];
  const grupos = [
    { titulo: 'Mañana', icono: 'wb_twilight' as const, lista: bloques.filter(esManana) },
    { titulo: 'Tarde', icono: 'wb_sunny' as const, lista: bloques.filter((b) => !esManana(b)) },
  ].filter((g) => g.lista.length);

  return (
    <div className="flex flex-col gap-5">
      {modalidades.length > 1 && activa && (
        <ControlSegmentado
          etiqueta="Modalidad"
          conLeyenda
          valor={activa}
          onChange={setModalidad}
          opciones={modalidades.map((m) => ({ valor: m, etiqueta: NOMBRE_MODALIDAD_CITA[m], icono: m === 'ONLINE' ? 'videocam' : 'meeting_room' }))}
        />
      )}

      <div>
        <div className="mb-2.5 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">Día</div>
        {/* Carril con scroll-snap: en movil se desliza; los dias sin horas no aparecen. */}
        <div role="radiogroup" aria-label="Día" className="-mx-1 flex snap-x gap-[9px] overflow-x-auto px-1 pb-2">
          {claves.map((k) => {
            const d = dias.get(k)![0]!.inicio;
            const marcado = k === diaActivo;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={marcado}
                aria-label={formatoFechaLarga(d)}
                onClick={() => setDia(k)}
                className={`flex w-[74px] flex-none cursor-pointer snap-start flex-col items-center gap-[3px] rounded-[16px] border-[1.5px] px-2 py-3 transition-colors duration-200 ${
                  marcado ? 'border-accent-2-600 bg-accent-2-700 text-neutral-100' : 'border-neutral-400 bg-bg text-text hover:border-accent-2-500'
                }`}
              >
                <span className="text-xs font-bold capitalize">{diaSemana.format(d).replace('.', '')}</span>
                <span className="text-[19px] font-black tracking-[-0.02em]">{diaMes.format(d)}</span>
                <span className="text-[11px] font-extrabold tracking-[0.06em] uppercase">{mes.format(d).replace('.', '')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {grupos.map((g) => (
        <div key={g.titulo}>
          <div className="mb-[11px] flex items-center gap-[9px] text-[12.5px] font-extrabold text-neutral-700">
            <Icon name={g.icono} className="text-neutral-600" />
            {g.titulo}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
            {g.lista.map((b) => {
              const marcado = igual(valor, b);
              return (
                <button
                  key={b.inicio.toISOString()}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => onElegir(b)}
                  className={`min-h-11 cursor-pointer rounded-[14px] border-[1.5px] px-2.5 py-3 text-sm font-extrabold tabular-nums transition-[background-color,border-color,transform] duration-200 active:scale-[0.97] ${
                    marcado ? 'border-accent-2-700 bg-accent-2-700 text-neutral-100' : 'border-neutral-400 bg-bg text-text hover:border-accent-2-600'
                  }`}
                >
                  {formatoHora(b.inicio)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
