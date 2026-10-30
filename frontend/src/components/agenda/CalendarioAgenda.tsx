'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { useHorarioCentro } from '@/lib/centro';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { dia } from '@/lib/horarios';
import {
  fechaHoyChile,
  mesChile,
  nombreDeCita,
  nombresPacientes,
  semanaChile,
  useAhora,
  useCitas,
  useEquipoAgenda,
  useEspacios,
  usePacientes,
  useRetencionesAjenas,
  type CitaVista,
} from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { ALTO_HORA_MINIMO, ESTADOS_VISUALES, carriles, estadoVisual, horaInicioCentro, minutosChile, posicion, type EstadoVisual } from './grillaAgenda';
import { TONOS, tonoDe, type Tono } from './tonosAgenda';

export type VistaAgenda = 'semana' | 'mes';
/** Por profesional ("Mi horario" del profesional) o por box. */
export type ModoAgenda = 'profesional' | 'box';

/** Preferencias sin datos sensibles: la ultima vista y si las sesiones van encima del box. */
const CLAVE_VISTA = 'vinculos_vista_agenda';
const CLAVE_ENCIMA = 'vinculos_agenda_encima';
const leer = (clave: string) => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const guardar = (clave: string, valor: string) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Almacen bloqueado: la preferencia dura solo esta visita.
  }
};

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MAX_EN_DIA = 3;
const SEMANA_MS = 7 * 86_400_000;
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', ...o });
const diaColumna = fmt({ weekday: 'short', day: 'numeric' });
const diaMes = fmt({ day: 'numeric', month: 'short' });
const mesTitulo = fmt({ month: 'long', year: 'numeric' });
const horaCorta = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const mediodia = (d: string) => new Date(`${d}T12:00:00Z`);
const contar = (n: number) => (n === 1 ? '1 cita' : `${n} citas`);

/** Fondo de la grilla (sin paciente ni quien): libre del box, ocupado, apartado propio o reservando. */
type ClaseFondo = 'libre' | 'ocupado' | 'propio' | 'reservando';
const TEXTO_FONDO: Record<ClaseFondo, string> = { libre: 'Libre', ocupado: 'Ocupado', propio: 'Tu horario apartado', reservando: 'Reservando…' };

type Evento =
  { tipo: 'cita'; cita: CitaVista; inicio: string; fin: string } | { tipo: 'fondo'; clase: ClaseFondo; espacioId: string | null; inicio: string; fin: string };

interface Columna {
  clave: string;
  titulo: string;
  /** Dia (AAAA-MM-DD) de la columna: para la linea de la hora actual. */
  dia: string;
  eventos: Evento[];
}

/**
 * Calendario de la agenda (03b-4.2, ajustes 2026-10-29): Semana | Mes en una
 * grilla de tiempo real que va de la apertura del centro (configurable; 08:00
 * sin horario) a las 24:00 y se estira al alto de la ventana. Una sola barra
 * de herramientas.
 *
 * - "Mi horario" / "Por profesional": sesiones del profesional (o de todo el
 *   equipo para ADMIN/GESTION, con color por profesional).
 * - "Por box": sesiones con el color de su box y las del profesional
 *   destacadas. Con un box elegido se ve su horario libre y lo ocupado (sin
 *   quien: ocupacion_espacios()) y encima las sesiones del profesional, para
 *   ver que no choquen (se puede apagar).
 *
 * Se refresca cada 2 minutos con la pestaña visible (estandar_polling.md).
 */
export function CalendarioAgenda({ rol, modo, onElegir, onAgendar }: { rol: Rol; modo: ModoAgenda; onElegir: (c: CitaVista) => void; onAgendar: () => void }) {
  const admin = esAdministracion(rol);
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const [vista, setVistaEstado] = useState<VistaAgenda>(() => (leer(CLAVE_VISTA) === 'mes' ? 'mes' : 'semana'));
  const [encima, setEncimaEstado] = useState(() => leer(CLAVE_ENCIMA) !== 'no');
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [boxId, setBoxId] = useState<string | null>(null);
  const { profesionalId, setProfesionalId } = useEquipoActivo();
  const cuenta = useMiCuenta();
  const modulos = useModulos();
  const ahora = useAhora();
  const desdeHora = horaInicioCentro(useHorarioCentro().data);

  const hoy = fechaHoyChile();
  const semana = semanaChile(vista === 'semana' ? desplazamiento : 0);
  const mes = mesChile(vista === 'mes' ? desplazamiento : 0);
  const rango = vista === 'semana' ? { desde: semana.desde, hasta: semana.hasta } : { desde: mes.desde, hasta: mes.hasta };
  const filtro = admin ? (profesionalId ?? undefined) : undefined;
  const box = modo === 'box' ? boxId : null;

  const citas = useCitas({ ...rango, profesionalId: filtro }, true, { sondeo: true });
  const reservando = useRetencionesAjenas({ ...rango, profesionalId: filtro }).data ?? [];
  const equipo = useEquipoAgenda();
  const espacios = useEspacios();
  const pacientes = usePacientes();
  // Box elegido: su horario libre y lo ocupado (sin quien); el profesional distingue lo que aparto el.
  const ocupacion = useQuery({
    queryKey: ['panel', 'espacios', 'ocupacion', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/espacios/ocupacion', { params: { query: rango } })),
    enabled: !!box,
  });
  const libres = useQuery({
    queryKey: ['panel', 'espacios', 'disponibilidad', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/espacios/disponibilidad', { params: { query: rango } })),
    enabled: !!box,
  });
  const propios = useQuery({
    queryKey: ['panel', 'bloques', cuenta.data?.id, rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/profesionales/{profesionalId}/bloques', { params: { path: { profesionalId: cuenta.data!.id }, query: rango } })),
    enabled: !!box && clinico && !!cuenta.data?.id,
  });
  // Simbolos de estado: sesiones con evolucion (solo el equipo tratante: es clinico) e inasistencias (Cobros).
  const evolucion = useQuery({
    queryKey: ['panel', 'citas-con-evolucion', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/citas-con-evolucion', { params: { query: rango } })),
    enabled: clinico,
  });
  const cobros = useQuery({
    queryKey: ['panel', 'cobros-citas', rango.desde, rango.hasta, filtro],
    queryFn: () => datos(api.GET('/api/cobros/citas', { params: { query: { ...rango, profesionalId: filtro } } })),
    enabled: rol !== 'PRACTICANTE' && !!modulos.data?.activos.includes('COBROS'),
  });

  const setVista = (v: VistaAgenda) => {
    setVistaEstado(v);
    setDesplazamiento(0);
    guardar(CLAVE_VISTA, v);
  };
  const setEncima = (v: boolean) => {
    setEncimaEstado(v);
    guardar(CLAVE_ENCIMA, v ? 'si' : 'no');
  };

  const nombres = nombresPacientes(pacientes.data);
  const ordenEquipo = (equipo.data ?? []).map((m) => m.id);
  const ordenBox = (espacios.data ?? []).map((e) => e.id);
  const nombreProfesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const nombreBox = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const conEvolucion = new Set(evolucion.data ?? []);
  const inasistencias = new Set((cobros.data ?? []).filter((c) => c.inasistencia).map((c) => c.cita_id));

  const visibles = (citas.data ?? []).filter((c) => c.estado !== 'CANCELADA' && c.estado !== 'LIBERADA');
  const variosProfesionales = admin && !filtro;
  const tonoBox = (espacioId: string | null) => (espacioId ? tonoDe(ordenBox, espacioId) : TONOS[3]!);
  const tonoCita = (c: CitaVista): Tono => (modo === 'box' ? tonoBox(c.espacioId) : variosProfesionales ? tonoDe(ordenEquipo, c.profesionalId) : TONOS[1]!);
  // Por box: las sesiones del profesional van destacadas (prioridad sobre el resto del box).
  const destacada = (c: CitaVista) => modo === 'box' && (clinico || c.profesionalId === filtro || c.profesionalId === cuenta.data?.id);
  const estadoDe = (c: CitaVista) =>
    estadoVisual(c, { ahora, conEvolucion: clinico && evolucion.isSuccess ? conEvolucion.has(c.id) : undefined, inasistencia: inasistencias.has(c.id) });

  // Box elegido: de fondo sus horas libres y ocupadas; encima, las sesiones del profesional (todas: un choque
  // puede ser en otro box u online) o, para ADMIN/GESTION sin filtro de profesional, las de ese box.
  const fondo: Evento[] = [
    ...(box
      ? [
          ...(libres.data ?? [])
            .filter((l) => l.espacioId === box)
            .map((l) => ({ tipo: 'fondo' as const, clase: 'libre' as const, espacioId: box, inicio: l.inicio, fin: l.fin })),
          ...(ocupacion.data ?? [])
            .filter((o) => o.espacio_id === box)
            .map((o) => ({
              tipo: 'fondo' as const,
              clase: (propios.data ?? []).some((b) => b.espacioId === o.espacio_id && b.inicio <= o.inicio && b.fin >= o.fin)
                ? ('propio' as const)
                : ('ocupado' as const),
              espacioId: box,
              inicio: o.inicio,
              fin: o.fin,
            })),
        ]
      : []),
    ...reservando
      .filter((r) => !box || r.espacioId === box)
      .map((r) => ({ tipo: 'fondo' as const, clase: 'reservando' as const, espacioId: r.espacioId, inicio: r.inicio, fin: r.fin })),
  ];
  const sesiones = box ? (encima ? visibles.filter((c) => clinico || !!filtro || c.espacioId === box) : []) : visibles;
  const eventos: Evento[] = [...sesiones.map((c) => ({ tipo: 'cita' as const, cita: c, inicio: c.inicio, fin: c.fin })), ...fondo];
  const delDia = (d: string) => eventos.filter((e) => dia(new Date(e.inicio)) === d);

  const finDeSemana = eventos.some((e) => [semana.dias[5], semana.dias[6]].includes(dia(new Date(e.inicio))));
  const columnas: Columna[] = semana.dias
    .slice(0, finDeSemana ? 7 : 5)
    .map((d) => ({ clave: d, titulo: diaColumna.format(mediodia(d)), dia: d, eventos: delDia(d) }));

  const etiqueta =
    vista === 'semana' ? `${diaMes.format(mediodia(semana.dias[0]!))} – ${diaMes.format(mediodia(semana.dias[6]!))}` : mesTitulo.format(mediodia(mes.primero));
  const unidad = vista === 'semana' ? 'Semana' : 'Mes';

  const leyendaColores =
    modo === 'box'
      ? [...new Set([...(box ? [box] : []), ...sesiones.map((c) => c.espacioId ?? 'online')])].map((id) => ({
          id,
          nombre: id === 'online' ? 'Online' : (nombreBox.get(id) ?? 'Box'),
          tono: id === 'online' ? TONOS[3]! : tonoBox(id),
        }))
      : variosProfesionales
        ? [...new Set(sesiones.map((c) => c.profesionalId))].map((id) => ({
            id,
            nombre: nombreProfesional.get(id) ?? 'Profesional',
            tono: tonoDe(ordenEquipo, id),
          }))
        : [];
  const estadosPresentes = [...new Set(sesiones.map(estadoDe).filter((e): e is EstadoVisual => !!e))];
  const fondosPresentes = [...new Set(fondo.flatMap((f) => (f.tipo === 'fondo' ? [f.clase] : [])))];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="toolbar" aria-label="Controles de la agenda" className="flex flex-wrap items-center gap-2.5">
        <ControlSegmentado
          etiqueta="Vista de la agenda"
          tono="team"
          valor={vista}
          onChange={setVista}
          opciones={[
            { valor: 'semana', etiqueta: 'Semana', icono: 'view_week' },
            { valor: 'mes', etiqueta: 'Mes', icono: 'calendar_view_month' },
          ]}
        />
        <div className="flex items-center gap-1">
          <BotonIcono etiqueta={`${unidad} anterior`} icono="chevron_left" onClick={() => setDesplazamiento((n) => n - 1)} />
          <Button variant="secondary" disabled={desplazamiento === 0} onClick={() => setDesplazamiento(0)} className="!min-h-10 !px-4 !py-2 !text-[13px]">
            Hoy
          </Button>
          <BotonIcono etiqueta={`${unidad} siguiente`} icono="chevron_right" onClick={() => setDesplazamiento((n) => n + 1)} />
        </div>
        <h2 aria-live="polite" className="m-0 min-w-[130px] text-[15px] font-black tracking-[-0.01em] first-letter:uppercase">
          {etiqueta}
        </h2>
        {modo === 'box' && (
          <Select
            aria-label="Filtrar por box"
            value={boxId ?? ''}
            onChange={(e) => setBoxId(e.target.value || null)}
            className="!min-h-10 !w-auto !py-1.5 !text-[13px]"
          >
            <option value="">Todos los boxes</option>
            {(espacios.data ?? [])
              .filter((e) => e.activo)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
          </Select>
        )}
        {box && (
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-extrabold text-neutral-800">
            <input type="checkbox" checked={encima} onChange={(e) => setEncima(e.target.checked)} className="size-[18px] cursor-pointer accent-accent-700" />
            {clinico ? 'Mis sesiones encima' : 'Sesiones encima'}
          </label>
        )}
        {admin && (
          // Mismo filtro que el selector de equipo del menu (EquipoActivo).
          <Select
            aria-label="Profesional de la agenda"
            value={profesionalId ?? ''}
            onChange={(e) => setProfesionalId(e.target.value || null)}
            className="!min-h-10 !w-auto !py-1.5 !text-[13px]"
          >
            <option value="">Todo el equipo</option>
            {(equipo.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre ?? 'Profesional'}
              </option>
            ))}
          </Select>
        )}
        <Button variant="team" icon="event" onClick={onAgendar} className="ml-auto">
          Agendar sesión
        </Button>
      </div>

      <Leyenda colores={leyendaColores} estados={estadosPresentes} fondos={fondosPresentes} />

      <EstadoConsulta consulta={citas}>
        {() =>
          vista === 'mes' ? (
            <VistaMes
              mes={mes}
              hoy={hoy}
              eventos={eventos}
              etiquetaCita={(c) => nombreDeCita(nombres, c)}
              tonoCita={tonoCita}
              estadoDe={estadoDe}
              onElegir={onElegir}
              onDia={(d) => {
                setVistaEstado('semana');
                setDesplazamiento(Math.floor((mediodia(d).getTime() - mediodia(semanaChile(0).dias[0]!).getTime()) / SEMANA_MS));
              }}
            />
          ) : (
            <GrillaTiempo
              columnas={columnas}
              hoy={hoy}
              ahora={ahora}
              desdeHora={desdeHora}
              render={(e) =>
                e.tipo === 'fondo' ? (
                  <Fondo clase={e.clase} lugar={box ? null : e.espacioId ? (nombreBox.get(e.espacioId) ?? 'Box') : 'Online'} />
                ) : (
                  <TarjetaCita
                    cita={e.cita}
                    paciente={nombreDeCita(nombres, e.cita)}
                    profesional={variosProfesionales ? (nombreProfesional.get(e.cita.profesionalId) ?? 'Profesional') : undefined}
                    box={e.cita.espacioId ? (nombreBox.get(e.cita.espacioId) ?? 'Box') : null}
                    tono={tonoCita(e.cita)}
                    estado={estadoDe(e.cita)}
                    destacada={destacada(e.cita)}
                    onElegir={onElegir}
                  />
                )
              }
            />
          )
        }
      </EstadoConsulta>
    </div>
  );
}

function BotonIcono({ etiqueta, icono, onClick }: { etiqueta: string; icono: 'chevron_left' | 'chevron_right'; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={onClick}
      className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-accent-200 focus-visible:outline-2 focus-visible:outline-accent-700"
    >
      <Icon name={icono} />
    </button>
  );
}

const CLASE_FONDO: Record<ClaseFondo, string> = {
  libre: 'border-dashed border-accent-2-600 bg-bg text-accent-2-800',
  ocupado: 'border-dashed border-neutral-500 bg-neutral-200/70 text-neutral-800',
  propio: 'border-accent-500 bg-accent-100/70 text-accent-800',
  reservando: 'border-dashed border-neutral-500 bg-neutral-200/70 text-neutral-800',
};

/** Bloque de fondo (sin paciente ni quien). */
function Fondo({ clase, lugar }: { clase: ClaseFondo; lugar: string | null }) {
  return (
    <span className={`flex h-full min-w-0 flex-col overflow-hidden rounded-lg border px-1.5 py-1 text-[11px] leading-tight font-bold ${CLASE_FONDO[clase]}`}>
      <span className="truncate font-black">{TEXTO_FONDO[clase]}</span>
      {lugar && <span className="truncate">{lugar}</span>}
    </span>
  );
}

function Leyenda({ colores, estados, fondos }: { colores: { id: string; nombre: string; tono: Tono }[]; estados: EstadoVisual[]; fondos: ClaseFondo[] }) {
  if (colores.length === 0 && estados.length === 0 && fondos.length === 0) return null;
  return (
    <ul aria-label="Leyenda" className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[12px] font-bold text-neutral-800">
      {colores.map((l) => (
        <li key={l.id} className="inline-flex items-center gap-1.5">
          <span className={`size-[11px] rounded-[4px] border ${l.tono.muestra}`} aria-hidden />
          {l.nombre}
        </li>
      ))}
      {colores.length > 0 && estados.length + fondos.length > 0 && <li aria-hidden className="h-4 w-px bg-divider" />}
      {estados.map((e) => (
        <li key={e} className="inline-flex items-center gap-1">
          <Icon name={ESTADOS_VISUALES[e].icono} size={15} className="text-neutral-700" />
          {ESTADOS_VISUALES[e].texto}
        </li>
      ))}
      {fondos.map((f) => (
        <li key={f} className="inline-flex items-center gap-1.5">
          <span className={`size-[11px] rounded-[4px] border ${CLASE_FONDO[f]}`} aria-hidden />
          {f === 'ocupado' || f === 'reservando' ? `${TEXTO_FONDO[f]} por otra persona` : TEXTO_FONDO[f]}
        </li>
      ))}
    </ul>
  );
}

/**
 * Grilla de tiempo: una columna por dia con encabezado fijo y contador. Va de
 * desdeHora a las 24:00 y estira las horas al alto disponible (minimo
 * ALTO_HORA_MINIMO por hora; bajo eso, scroll interno).
 */
function GrillaTiempo({
  columnas,
  hoy,
  ahora,
  desdeHora,
  render,
}: {
  columnas: Columna[];
  hoy: string;
  ahora: number;
  desdeHora: number;
  render: (e: Evento) => ReactNode;
}) {
  const horas = Array.from({ length: 24 - desdeHora }, (_, i) => desdeHora + i);
  const pct = (h: number) => `${((h - desdeHora) / horas.length) * 100}%`;
  const plantilla = { gridTemplateColumns: `56px repeat(${columnas.length}, minmax(140px, 1fr))` };
  const minutoAhora = minutosChile(new Date(ahora));
  return (
    <section aria-label="Calendario" className="flex min-h-0 flex-1 flex-col overflow-auto rounded-[var(--radius-lg)] border border-divider bg-bg shadow-md">
      <div className="sticky top-0 z-[4] grid flex-none border-b border-divider bg-neutral-200" style={plantilla}>
        <span className="sticky left-0 bg-neutral-200" aria-hidden />
        {columnas.map((c) => {
          const citas = c.eventos.filter((e) => e.tipo === 'cita').length;
          return (
            <span key={c.clave} className="flex min-w-0 items-baseline justify-between gap-2 border-l border-divider px-2.5 py-1.5">
              <span className={`truncate text-[13px] font-black first-letter:uppercase ${c.dia === hoy ? 'text-accent-800' : ''}`}>
                {c.titulo}
                {c.dia === hoy && <span className="sr-only"> (hoy)</span>}
              </span>
              <span className="flex-none text-[11.5px] font-extrabold text-neutral-700 tabular-nums">{contar(citas)}</span>
            </span>
          );
        })}
      </div>
      <div className="relative grid flex-[1_0_auto]" style={{ ...plantilla, minHeight: horas.length * ALTO_HORA_MINIMO }}>
        <div className="sticky left-0 z-[3] bg-bg">
          {horas.map((h) => (
            <span
              key={h}
              className="absolute right-2 text-[11px] font-extrabold text-neutral-700 tabular-nums"
              style={{ top: pct(h), transform: h === desdeHora ? 'translateY(2px)' : 'translateY(-50%)' }}
            >
              {`${String(h).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        {columnas.map((c) => {
          // El fondo va con sus carriles; las sesiones encima, con los suyos.
          const lugar = new Map<Evento, { carril: number; total: number }>([
            ...carriles(c.eventos.filter((e) => e.tipo !== 'cita')),
            ...carriles(c.eventos.filter((e) => e.tipo === 'cita')),
          ]);
          return (
            <div key={c.clave} className="relative border-l border-divider">
              {horas.map((h) => (
                <span key={h} aria-hidden className="absolute inset-x-0 border-t border-divider/70" style={{ top: pct(h) }} />
              ))}
              {c.dia === hoy && minutoAhora >= desdeHora * 60 && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 z-[3] border-t-2 border-accent-700"
                  style={{ top: `${((minutoAhora - desdeHora * 60) / (horas.length * 60)) * 100}%` }}
                >
                  <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-accent-700" />
                </span>
              )}
              {c.eventos.map((e, i) => {
                const p = posicion(e.inicio, e.fin, desdeHora);
                if (p.alto <= 0) return null;
                const l = lugar.get(e) ?? { carril: 0, total: 1 };
                return (
                  <div
                    key={e.tipo === 'cita' ? e.cita.id : `f-${i}-${e.inicio}`}
                    className={`absolute px-[2px] ${e.tipo === 'cita' ? 'z-[2]' : 'z-0'}`}
                    style={{ top: `${p.top}%`, height: `${p.alto}%`, minHeight: 22, left: `${(l.carril / l.total) * 100}%`, width: `${100 / l.total}%` }}
                  >
                    {render(e)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Tarjeta compacta: estado (simbolo), hora, paciente, profesional (multi), modalidad y box. */
function TarjetaCita({
  cita,
  paciente,
  profesional,
  box,
  tono,
  estado,
  destacada,
  onElegir,
}: {
  cita: CitaVista;
  paciente: string;
  profesional?: string;
  box: string | null;
  tono: Tono;
  estado: EstadoVisual | null;
  destacada: boolean;
  onElegir: (c: CitaVista) => void;
}) {
  const e = estado ? ESTADOS_VISUALES[estado] : null;
  const pendiente = estado === 'pendiente_pago' || estado === 'retenida' || estado === 'por_reprogramar' || estado === 'sin_evolucion';
  const lugar = cita.modalidad === 'ONLINE' ? 'Online' : (box ?? 'Presencial');
  return (
    <button
      type="button"
      onClick={() => onElegir(cita)}
      aria-label={`${horaCorta.format(new Date(cita.inicio))} ${paciente}${profesional ? `, ${profesional}` : ''}, ${lugar}${e ? `, ${e.texto}` : ''}`}
      className={`flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border px-1.5 py-1 text-left leading-tight transition-shadow duration-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent-700 ${
        estado === 'retenida' ? 'border-dashed border-accent-500 bg-accent-100' : pendiente ? `border-accent-500 ${tono.suave}` : `border-divider ${tono.suave}`
      } ${destacada ? 'shadow-md ring-2 ring-accent-700' : ''}`}
    >
      <span className={`flex min-w-0 items-center gap-1 text-[12px] font-black ${tono.texto}`}>
        {e && <Icon name={e.icono} size={14} className="flex-none" />}
        <span className="flex-none tabular-nums">{horaCorta.format(new Date(cita.inicio))}</span>
        <span className="truncate">{paciente}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-neutral-800">
        <Icon name={cita.modalidad === 'ONLINE' ? 'videocam' : 'meeting_room'} size={13} className="flex-none" />
        <span className="truncate">{profesional ? `${profesional} · ${lugar}` : lugar}</span>
      </span>
    </button>
  );
}

function VistaMes({
  mes,
  hoy,
  eventos,
  etiquetaCita,
  tonoCita,
  estadoDe,
  onElegir,
  onDia,
}: {
  mes: { primero: string; dias: string[] };
  hoy: string;
  eventos: Evento[];
  etiquetaCita: (c: CitaVista) => string;
  tonoCita: (c: CitaVista) => Tono;
  estadoDe: (c: CitaVista) => EstadoVisual | null;
  onElegir: (c: CitaVista) => void;
  onDia: (d: string) => void;
}) {
  return (
    <section aria-label="Calendario del mes" className="min-h-[420px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-divider bg-bg shadow-md">
      <div className="grid min-w-[760px] grid-cols-7">
        {DIAS_SEMANA.map((d) => (
          <span
            key={d}
            className="sticky top-0 z-[1] border-b border-divider bg-neutral-200 px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase"
          >
            {d}
          </span>
        ))}
        {mes.dias.map((d) => {
          const delMes = d.slice(0, 7) === mes.primero.slice(0, 7);
          const enDia = eventos
            .filter((e): e is Extract<Evento, { tipo: 'cita' }> => e.tipo === 'cita' && dia(new Date(e.inicio)) === d)
            .sort((a, b) => a.inicio.localeCompare(b.inicio));
          return (
            <div
              key={d}
              className={`flex min-h-[104px] min-w-0 flex-col gap-1 border-r border-b border-divider p-1.5 [&:nth-child(7n)]:border-r-0 ${delMes ? '' : 'bg-neutral-100'}`}
            >
              <button
                type="button"
                onClick={() => onDia(d)}
                aria-label={`Ver la semana del ${Number(d.slice(8))}${enDia.length ? `, ${contar(enDia.length)}` : ''}`}
                className="flex cursor-pointer items-center justify-between gap-1 rounded-full px-1 hover:bg-accent-100"
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-[12.5px] font-black tabular-nums ${d === hoy ? 'bg-accent-700 text-neutral-100' : delMes ? '' : 'text-neutral-700'}`}
                >
                  {Number(d.slice(8))}
                </span>
                {enDia.length > 0 && <span className="text-[11px] font-extrabold text-neutral-700 tabular-nums">{enDia.length}</span>}
              </button>
              {enDia.slice(0, MAX_EN_DIA).map(({ cita: c }) => {
                const tono = tonoCita(c);
                const e = estadoDe(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onElegir(c)}
                    className={`flex min-w-0 cursor-pointer items-center gap-1 rounded-md border border-divider px-1.5 py-0.5 text-left text-[11.5px] font-bold focus-visible:outline-2 focus-visible:outline-accent-700 ${tono.suave}`}
                  >
                    {e && <Icon name={ESTADOS_VISUALES[e].icono} size={13} className={`flex-none ${tono.texto}`} />}
                    <span className="tabular-nums">{horaCorta.format(new Date(c.inicio))}</span>
                    <span className={`truncate font-black ${tono.texto}`}>{etiquetaCita(c)}</span>
                  </button>
                );
              })}
              {enDia.length > MAX_EN_DIA && (
                <button
                  type="button"
                  onClick={() => onDia(d)}
                  className="cursor-pointer self-start rounded-full px-1.5 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
                >
                  +{enDia.length - MAX_EN_DIA} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
