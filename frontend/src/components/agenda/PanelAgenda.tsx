'use client';

import { useQuery } from '@tanstack/react-query';

import { api, datos } from '@/lib/api/cliente';
import { bloquesDeSesion } from '@/lib/horarios';
import { hoyChile, nombreDeCita, useCitas, type CitaVista, type EspacioVista } from '@/lib/panel';

export type FiltroModalidad = 'todas' | 'PRESENCIAL' | 'ONLINE';

interface Tramo {
  inicio: string;
  fin: string;
}

const ms = (iso: string) => new Date(iso).getTime();
const dentro = (t: Tramo, ahora: number) => ms(t.inicio) <= ahora && ahora < ms(t.fin);
const duracion = (l: Tramo[]) => l.reduce((s, t) => s + (ms(t.fin) - ms(t.inicio)), 0);
const DIA_MS = 86_400_000;
const zona = { timeZone: 'America/Santiago' } as const;
const fechaCorta = new Intl.DateTimeFormat('es-CL', { ...zona, weekday: 'short', day: 'numeric', month: 'short' });
const horaCorta = new Intl.DateTimeFormat('es-CL', { ...zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const MAX_POR_CONFIRMAR = 4;
const MODALIDADES: { valor: FiltroModalidad; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'PRESENCIAL', etiqueta: 'Presencial' },
  { valor: 'ONLINE', etiqueta: 'Online' },
];

/** Plazo de pago en palabras: dias, horas o vencido (la hora del equipo se mantiene y se paga en el centro). */
function textoPlazo(vence: string, ahora: number): string {
  const resta = ms(vence) - ahora;
  if (resta <= 0) return 'Plazo vencido: se paga en el centro';
  if (resta < DIA_MS) {
    const h = Math.max(1, Math.round(resta / 3_600_000));
    return `Vence en ${h} ${h === 1 ? 'hora' : 'horas'} si no se paga`;
  }
  const d = Math.ceil(resta / DIA_MS);
  return `Vence en ${d} ${d === 1 ? 'día' : 'días'} si no se paga`;
}

/**
 * Panel lateral de la agenda (design-reference "Opcion A semana unificada"):
 * filtro de modalidad con el conteo del rango, boxes del centro (estado ahora,
 * ocupacion y horas libres del rango; al elegir uno, sus horas libres se ven
 * sobre la semana) y las horas por confirmar (pago pendiente). Cada hora por
 * confirmar abre el detalle de la sesion, donde se registra el pago.
 */
export function PanelAgenda({
  etiquetaRango,
  modalidad,
  onModalidad,
  conteo,
  espacios,
  libres,
  ocupacion,
  sesionesBox,
  boxId,
  onBox,
  ahora,
  rangoConAhora,
  profesionalId,
  nombres,
  onElegir,
  onVerPendientes,
}: {
  etiquetaRango: string;
  modalidad: FiltroModalidad;
  onModalidad: (m: FiltroModalidad) => void;
  conteo: { presencial: number; online: number };
  espacios: EspacioVista[];
  libres: (Tramo & { espacioId: string })[];
  ocupacion: (Tramo & { espacio_id: string })[];
  sesionesBox: (Tramo & { espacio_id: string })[];
  boxId: string | null;
  onBox: (id: string | null) => void;
  ahora: number;
  /** El rango visible incluye el momento actual: se muestra el estado "ahora" de cada box. */
  rangoConAhora: boolean;
  profesionalId?: string;
  nombres: Map<string, string>;
  onElegir: (c: CitaVista) => void;
  onVerPendientes: () => void;
}) {
  const porPagar = useCitas({ estado: 'PENDIENTE_PAGO', desde: hoyChile().desde, profesionalId });
  const porReprogramar = useQuery({ queryKey: ['panel', 'citas', 'por-reprogramar'], queryFn: () => datos(api.GET('/api/citas/por-reprogramar')) });
  const nombreBox = new Map(espacios.map((e) => [e.id, e.nombre]));
  const pendientes = [...(porPagar.data ?? [])].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const reprogramar = (porReprogramar.data ?? []).filter((c) => !profesionalId || c.profesionalId === profesionalId).length;
  const s = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  return (
    <aside aria-label="Panel de la agenda" className="flex min-w-0 flex-col gap-3.5 lg:w-[300px] lg:flex-none lg:overflow-y-auto lg:pr-0.5">
      <section aria-labelledby="panel-modalidad" className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-divider bg-neutral-100 p-4">
        <h2 id="panel-modalidad" className="m-0 text-[15px] font-black tracking-[-0.01em]">
          Modalidad
        </h2>
        {/* Tres botones de igual ancho (diseño): ControlSegmentado se desborda en el panel angosto. */}
        <div role="group" aria-label="Filtrar por modalidad" className="flex gap-1 rounded-[12px] bg-neutral-200 p-1">
          {MODALIDADES.map((m) => (
            <button
              key={m.valor}
              type="button"
              aria-pressed={modalidad === m.valor}
              onClick={() => onModalidad(m.valor)}
              className={`min-h-[38px] flex-1 cursor-pointer rounded-[9px] text-[13px] font-extrabold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent-700 motion-reduce:transition-none ${
                modalidad === m.valor ? 'bg-accent-700 text-neutral-100' : 'hover:bg-neutral-300'
              }`}
            >
              {m.etiqueta}
            </button>
          ))}
        </div>
        <p className="m-0 text-[12px] font-semibold text-neutral-800">
          {etiquetaRango}: {s(conteo.presencial, 'presencial', 'presenciales')} · {conteo.online} online
        </p>
      </section>

      <section aria-labelledby="panel-boxes" className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-divider bg-neutral-100 p-4">
        <div className="flex items-baseline gap-2">
          <h2 id="panel-boxes" className="m-0 text-[15px] font-black tracking-[-0.01em]">
            Boxes
          </h2>
          {rangoConAhora && (
            <span className="text-[12px] font-semibold text-neutral-700">
              ahora · {fechaCorta.format(ahora).split(',')[0]} {horaCorta.format(ahora)}
            </span>
          )}
        </div>
        <p className="m-0 text-[12px] font-semibold text-neutral-800">Toca un box para ver sus horas libres sobre tu agenda.</p>
        {espacios.length === 0 && <p className="m-0 text-[12.5px] font-semibold text-neutral-700">El centro no tiene boxes activos.</p>}
        {espacios.map((e) => {
          const suyas = libres.filter((l) => l.espacioId === e.id);
          const apartado = ocupacion.filter((o) => o.espacio_id === e.id);
          const libreMs = duracion(suyas);
          const total = libreMs + duracion(apartado);
          const pct = total === 0 ? 100 : Math.round(((total - libreMs) / total) * 100);
          const horas = bloquesDeSesion(
            suyas.map((l) => ({ modalidad: 'PRESENCIAL' as const, inicio: l.inicio, fin: l.fin })),
            new Date(ahora),
          ).length;
          const estado = sesionesBox.some((x) => x.espacio_id === e.id && dentro(x, ahora))
            ? 'Ocupado'
            : suyas.some((l) => dentro(l, ahora))
              ? 'Libre'
              : apartado.some((o) => dentro(o, ahora))
                ? 'Apartado'
                : 'Cerrado';
          const libreAhora = estado === 'Libre';
          const elegido = boxId === e.id;
          const textoHoras = horas === 0 ? 'Sin horas' : `${horas} h libres`;
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={elegido}
              onClick={() => onBox(elegido ? null : e.id)}
              aria-label={`${e.nombre}${rangoConAhora ? `, ahora ${estado.toLowerCase()}` : ''}, ${textoHoras}`}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-[12px] px-3 py-2.5 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent-700 motion-reduce:transition-none ${
                elegido ? 'border-2 border-accent-2-700 bg-accent-2-200' : 'border border-divider bg-bg hover:bg-accent-2-100'
              }`}
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate text-[14px] font-extrabold">{e.nombre}</span>
                {rangoConAhora && (
                  <span
                    className={`ml-auto flex-none rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                      libreAhora ? 'bg-accent-2-200 text-accent-2-800' : 'bg-neutral-200 text-neutral-800'
                    }`}
                  >
                    {estado}
                  </span>
                )}
              </span>
              <span className="flex w-full items-center gap-2">
                <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-300">
                  <span className={`block h-full ${pct >= 100 ? 'bg-accent-700' : 'bg-accent-2-700'}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="min-w-[78px] text-right text-[11.5px] font-semibold text-neutral-800 tabular-nums">{textoHoras}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section
        aria-labelledby="panel-confirmar"
        className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-pendiente-700/40 bg-pendiente-100 p-4"
      >
        <div className="flex items-center gap-2">
          <h2 id="panel-confirmar" className="m-0 text-[15px] font-black tracking-[-0.01em]">
            Por confirmar
          </h2>
          {pendientes.length > 0 && (
            <span className="rounded-full bg-pendiente-900 px-2 py-0.5 text-[11px] font-extrabold text-neutral-100 tabular-nums">{pendientes.length}</span>
          )}
        </div>
        {porPagar.isPending ? (
          <p className="m-0 text-[12.5px] font-semibold text-neutral-800">Cargando…</p>
        ) : porPagar.isError ? (
          <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
            No pudimos cargar las horas por confirmar.
          </p>
        ) : pendientes.length === 0 ? (
          <p className="m-0 text-[12.5px] font-semibold text-neutral-800">No hay horas con pago pendiente.</p>
        ) : (
          pendientes.slice(0, MAX_POR_CONFIRMAR).map((c) => {
            const lugar = c.modalidad === 'ONLINE' ? 'Online' : (nombreBox.get(c.espacioId ?? '') ?? 'Presencial');
            const plazo = c.pagoVenceEn ? Math.max(0, Math.min(1, (ms(c.pagoVenceEn) - ahora) / Math.max(1, ms(c.pagoVenceEn) - ms(c.createdAt)))) : null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onElegir(c)}
                className="flex cursor-pointer flex-col gap-1.5 rounded-[12px] border border-pendiente-700/30 bg-neutral-100 px-3 py-2.5 text-left transition-shadow duration-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent-700 motion-reduce:transition-none"
              >
                <span className="truncate text-[14px] font-extrabold">{nombreDeCita(nombres, c)}</span>
                <span className="text-[12px] font-semibold text-neutral-800 first-letter:uppercase">
                  {fechaCorta.format(new Date(c.inicio))}, {horaCorta.format(new Date(c.inicio))} · {lugar}
                </span>
                {plazo !== null && (
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-pendiente-700/20">
                    <span className="block h-full bg-pendiente-700" style={{ width: `${plazo * 100}%` }} />
                  </span>
                )}
                {c.pagoVenceEn && <span className="text-[12px] font-bold text-pendiente-900">{textoPlazo(c.pagoVenceEn, ahora)}</span>}
              </button>
            );
          })
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-pendiente-700/25 pt-2 text-[12px] font-semibold text-neutral-800">
          <span>Por reprogramar: {reprogramar === 0 ? 'ninguna' : reprogramar}</span>
          {(pendientes.length > MAX_POR_CONFIRMAR || reprogramar > 0) && (
            <button type="button" onClick={onVerPendientes} className="ml-auto cursor-pointer font-extrabold text-accent-700 hover:text-accent-800">
              Ver pendientes
            </button>
          )}
        </div>
      </section>
    </aside>
  );
}
