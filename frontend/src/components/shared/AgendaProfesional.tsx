'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { GrillaTiempo, TarjetaCita, type EventoGrilla } from '@/components/shared/GrillaTiempo';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useHorarioCentro } from '@/lib/centro';
import { formatoFechaCorta, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { estadoVisual, horaInicioCentro } from '@/lib/grillaAgenda';
import {
  fechaHoyChile,
  mesChile,
  nombreDeCita,
  nombresPacientes,
  semanaChile,
  useAhora,
  useCitas,
  useEspacios,
  usePacientes,
  type CitaVista,
} from '@/lib/panel';

type Vista = 'semana' | 'mes';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
const mediodia = (dia: string) => `${dia}T12:00:00`;
/** Semanas entre el lunes de la semana actual y el de `dia` (para pasar del mes a esa semana). */
const semanasHasta = (dia: string) => {
  const lunesActual = semanaChile(0).lunes;
  const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
  const lunes = new Date(`${dia}T12:00:00Z`).getTime() - ((dow + 6) % 7) * 86_400_000;
  return Math.round((lunes - new Date(`${lunesActual}T12:00:00Z`).getTime()) / (7 * 86_400_000));
};

/**
 * Agenda de un profesional en un popup ("Ver su agenda" del seguimiento del
 * equipo): solo consulta, por semana (por defecto) o mes. Cualquier cambio
 * (gestionar una sesion, agregar una hora) se hace en Agenda y Espacios, ya
 * filtrada por ese profesional.
 */
export function AgendaProfesional({ profesionalId, nombre }: { profesionalId: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button variant="secondary" icon="event" onClick={() => setAbierto(true)} className="!px-3.5 !py-2 !text-[12.5px]">
        Ver su agenda
      </Button>
      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={`Agenda de ${nombre}`}
        ancho="xl"
        descripcion="Vista rápida. Para cambiar o agregar algo, ábrelo en Agenda y Espacios."
      >
        {abierto && <Calendario profesionalId={profesionalId} onIr={() => setAbierto(false)} />}
      </Modal>
    </>
  );
}

function Calendario({ profesionalId, onIr }: { profesionalId: string; onIr: () => void }) {
  const [vista, setVista] = useState<Vista>('semana');
  const [semana, setSemana] = useState(0);
  const [mes, setMes] = useState(0);
  const rango = vista === 'semana' ? semanaChile(semana) : mesChile(mes);
  const citas = useCitas({ desde: rango.desde, hasta: rango.hasta, profesionalId });
  const nombres = nombresPacientes(usePacientes().data);
  const lista = (citas.data ?? []).filter((c) => c.estado !== 'CANCELADA' && c.estado !== 'LIBERADA').sort((a, b) => a.inicio.localeCompare(b.inicio));
  const mover = (d: number) => (vista === 'semana' ? setSemana((s) => s + d) : setMes((m) => m + d));
  const enActual = vista === 'semana' ? semana === 0 : mes === 0;
  const titulo =
    vista === 'semana'
      ? `${formatoFechaCorta(mediodia(rango.dias[0]!))} al ${formatoFechaCorta(mediodia(rango.dias[6]!))}`
      : new Date(mediodia((rango as ReturnType<typeof mesChile>).primero)).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  const agenda = `/admin/agenda?equipo=${profesionalId}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ControlSegmentado
          etiqueta="Vista de la agenda"
          tono="team"
          opciones={[
            { valor: 'semana', etiqueta: 'Semana' },
            { valor: 'mes', etiqueta: 'Mes' },
          ]}
          valor={vista}
          onChange={setVista}
        />
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label={vista === 'semana' ? 'Semana anterior' : 'Mes anterior'}
            onClick={() => mover(-1)}
            className="grid size-10 cursor-pointer place-items-center rounded-full border border-divider hover:bg-accent-100"
          >
            <Icon name="chevron_left" size={20} />
          </button>
          <span className="min-w-[150px] text-center text-[14px] font-extrabold first-letter:uppercase" aria-live="polite">
            {titulo}
          </span>
          <button
            type="button"
            aria-label={vista === 'semana' ? 'Semana siguiente' : 'Mes siguiente'}
            onClick={() => mover(1)}
            className="grid size-10 cursor-pointer place-items-center rounded-full border border-divider hover:bg-accent-100"
          >
            <Icon name="chevron_right" size={20} />
          </button>
        </span>
        {!enActual && (
          <button
            type="button"
            onClick={() => (vista === 'semana' ? setSemana(0) : setMes(0))}
            className="min-h-10 cursor-pointer rounded-full px-3 text-[13px] font-extrabold text-accent-700 hover:bg-accent-100"
          >
            {vista === 'semana' ? 'Esta semana' : 'Este mes'}
          </button>
        )}
      </div>

      <div>
        <EstadoConsulta consulta={citas}>
          {() =>
            vista === 'semana' ? (
              <Semana dias={rango.dias} lista={lista} nombres={nombres} agenda={agenda} />
            ) : (
              <Mes
                dias={rango.dias}
                primero={(rango as ReturnType<typeof mesChile>).primero}
                lista={lista}
                nombres={nombres}
                onDia={(dia) => {
                  setSemana(semanasHasta(dia));
                  setVista('semana');
                }}
              />
            )
          }
        </EstadoConsulta>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <ButtonLink href={`${agenda}&nueva=1`} variant="secondary" icon="add" onClick={onIr}>
          Agregar una hora
        </ButtonLink>
        <ButtonLink href={agenda} variant="team" icon="calendar_month" onClick={onIr}>
          Abrir en Agenda y Espacios
        </ButtonLink>
      </div>
    </div>
  );
}

/** Semana en la grilla de tiempo de Agenda y Espacios (solo lectura): tocar una sesion la abre alla. */
function Semana({ dias, lista, nombres, agenda }: { dias: string[]; lista: CitaVista[]; nombres: Map<string, string>; agenda: string }) {
  const router = useRouter();
  const box = new Map((useEspacios().data ?? []).map((e) => [e.id, e.nombre]));
  const desdeHora = horaInicioCentro(useHorarioCentro().data);
  const ahora = useAhora();
  const hoy = fechaHoyChile();
  const eventos: EventoGrilla[] = lista.map((c) => ({ tipo: 'cita', cita: c, inicio: c.inicio, fin: c.fin }));
  const finDeSemana = lista.some((c) => [dias[5], dias[6]].includes(diaDe(c.inicio)));
  const columnas = dias.slice(0, finDeSemana ? 7 : 5).map((d) => ({
    clave: d,
    titulo: new Date(mediodia(d)).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' }),
    dia: d,
    eventos: eventos.filter((e) => diaDe(e.inicio) === d),
  }));
  return (
    <div className="flex h-[min(62vh,640px)] min-h-[360px] flex-col">
      <GrillaTiempo
        columnas={columnas}
        hoy={hoy}
        ahora={ahora}
        desdeHora={desdeHora}
        altoHora={44}
        render={(e) =>
          e.tipo === 'cita' && (
            <TarjetaCita
              cita={e.cita}
              paciente={nombreDeCita(nombres, e.cita)}
              box={e.cita.espacioId ? (box.get(e.cita.espacioId) ?? 'Box') : null}
              estado={estadoVisual(e.cita, { ahora })}
              onElegir={(c) => router.push(`${agenda}&cita=${c.id}`)}
            />
          )
        }
      />
    </div>
  );
}

/** Mes en grilla de lunes a domingo; cada dia muestra sus sesiones y lleva a esa semana. */
function Mes({
  dias,
  primero,
  lista,
  nombres,
  onDia,
}: {
  dias: string[];
  primero: string;
  lista: CitaVista[];
  nombres: Map<string, string>;
  onDia: (dia: string) => void;
}) {
  const hoy = fechaHoyChile();
  const mes = primero.slice(0, 7);
  return (
    <div className="grid grid-cols-7 gap-1">
      {DIAS.map((d) => (
        <span key={d} className="pb-1 text-center text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">
          {d}
        </span>
      ))}
      {dias.map((dia) => {
        const del = lista.filter((c) => diaDe(c.inicio) === dia);
        const otroMes = dia.slice(0, 7) !== mes;
        return (
          <button
            key={dia}
            type="button"
            onClick={() => onDia(dia)}
            aria-label={`${formatoFechaLarga(mediodia(dia))}: ${del.length === 1 ? '1 sesión' : `${del.length} sesiones`}. Ver la semana`}
            className={`flex min-h-[78px] cursor-pointer flex-col gap-0.5 rounded-[10px] border p-1.5 text-left transition-colors duration-200 hover:border-accent-500 ${
              dia === hoy ? 'border-accent-700 bg-accent-100' : 'border-divider bg-bg'
            } ${otroMes ? 'opacity-50' : ''}`}
          >
            <span className="text-[12px] font-extrabold">{Number(dia.slice(8))}</span>
            {del.slice(0, 2).map((c) => (
              <span key={c.id} className="truncate text-[10.5px] font-semibold text-neutral-800">
                {formatoHora(c.inicio)} {nombreDeCita(nombres, c).split(' ')[0]}
              </span>
            ))}
            {del.length > 2 && <span className="text-[10.5px] font-extrabold text-accent-700">+{del.length - 2} más</span>}
          </button>
        );
      })}
    </div>
  );
}
