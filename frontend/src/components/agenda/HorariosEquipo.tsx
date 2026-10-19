'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFecha, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { dia } from '@/lib/horarios';
import { inicioDiaChile, instanteChile, semanaChile, sumarDias, useEquipoAgenda, useEspacios, type MiembroDirectorio } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { NOMBRE_MODALIDAD_CITA } from './SelectorHorario';
import { DIAS_SEMANA, hhmm, minutos } from './tonosAgenda';
import { MargenTraslado, useConflictosMargen } from './MargenTraslado';

type Habitual = components['schemas']['DisponibilidadHabitual'];
type Bloque = components['schemas']['BloqueAtencionVista'];
type Bloqueo = components['schemas']['BloqueoAgendaVista'];
type HoraLibre = components['schemas']['HoraLibreBox'];

const NOMBRE_ROL: Partial<Record<string, string>> = { PROFESIONAL: 'Profesional', PRACTICANTE: 'Practicante' };
const NOMBRE_MOTIVO: Record<Bloqueo['motivo'], string> = { VACACIONES: 'Vacaciones', LICENCIA: 'Licencia', PERSONAL: 'Personal', BAJA: 'Baja' };
const isoDow = (fecha: string) => ((new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const minutoLocal = (iso: string) => {
  const [h, m] = formatoHora(iso).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const claveBloques = (profesionalId: string, desde: string) => ['panel', 'bloques', profesionalId, desde];

/**
 * Pestaña "Horarios del equipo" (diseño "Agenda y Espacios"). Desde 03b la
 * agenda sale de las horas de box apartadas (`bloques_atencion`): solo eso se
 * ofrece a pacientes y al equipo. El horario habitual es la plantilla para
 * apartar; los bloqueos (vacaciones, licencia) restan horas. ADMIN/GESTION ven
 * a todo el equipo (o al elegido en el selector); el profesional, lo suyo.
 */
export function HorariosEquipo({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const equipo = useEquipoAgenda();
  const cuenta = useMiCuenta();
  const { profesionalId } = useEquipoActivo();
  const [semana, setSemana] = useState(0);
  const rango = semanaChile(semana);
  const visibles = (equipo.data ?? []).filter((m) => (admin ? !profesionalId || m.id === profesionalId : m.id === cuenta.data?.id));

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-label="Semana anterior"
          onClick={() => setSemana((s) => s - 1)}
          className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
        >
          <Icon name="chevron_left" />
        </button>
        <span className="min-w-[170px] text-center text-[13.5px] font-extrabold text-neutral-800" aria-live="polite">
          Horas apartadas · semana del {formatoFecha(rango.lunes).replace(/ de \d{4}$/, '')}
        </span>
        <button
          type="button"
          aria-label="Semana siguiente"
          onClick={() => setSemana((s) => s + 1)}
          className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
        >
          <Icon name="chevron_right" />
        </button>
      </div>
      <EstadoConsulta consulta={equipo} vacio={() => visibles.length === 0} textoVacio="No hay profesionales con agenda">
        {() => visibles.map((m) => <TarjetaHorario key={m.id} miembro={m} rango={rango} />)}
      </EstadoConsulta>
    </div>
  );
}

function TarjetaHorario({ miembro, rango }: { miembro: MiembroDirectorio; rango: ReturnType<typeof semanaChile> }) {
  const cliente = useQueryClient();
  const espacios = useEspacios();
  const nombreBox = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const habitual = useQuery({
    queryKey: ['panel', 'habitual', miembro.id],
    queryFn: () => datos(api.GET('/api/profesionales/{profesionalId}/disponibilidad', { params: { path: { profesionalId: miembro.id } } })),
  });
  const bloques = useQuery({
    queryKey: claveBloques(miembro.id, rango.desde),
    queryFn: () =>
      datos(
        api.GET('/api/profesionales/{profesionalId}/bloques', {
          params: { path: { profesionalId: miembro.id }, query: { desde: rango.desde, hasta: rango.hasta } },
        }),
      ),
  });
  const bloqueos = useQuery({
    queryKey: ['panel', 'bloqueos', miembro.id],
    queryFn: () => datos(api.GET('/api/profesionales/{profesionalId}/bloqueos', { params: { path: { profesionalId: miembro.id } } })),
  });
  const [modal, setModal] = useState<'habitual' | 'apartar' | 'bloquear' | 'margen' | null>(null);
  const esProfesional = miembro.roles.includes('PROFESIONAL');
  const [error, setError] = useState<string>();

  const liberar = useMutation({
    mutationFn: (id: string) => datos(api.DELETE('/api/profesionales/{profesionalId}/bloques/{id}', { params: { path: { profesionalId: miembro.id, id } } })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['panel', 'bloques', miembro.id] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'espacios', 'ocupacion'] });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? 'Ese bloque tiene citas o una reserva en curso: muévelas antes de liberarlo.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos liberar el bloque.',
      ),
  });
  const quitarBloqueo = useMutation({
    mutationFn: (id: string) => datos(api.DELETE('/api/profesionales/{profesionalId}/bloqueos/{id}', { params: { path: { profesionalId: miembro.id, id } } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['panel', 'bloqueos', miembro.id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos quitar el bloqueo.'),
  });

  const totalMin = (bloques.data ?? []).reduce((s, b) => s + (new Date(b.fin).getTime() - new Date(b.inicio).getTime()) / 60_000, 0);
  const porDia = new Map<string, Bloque[]>();
  for (const b of bloques.data ?? []) porDia.set(dia(new Date(b.inicio)), [...(porDia.get(dia(new Date(b.inicio))) ?? []), b]);
  const diasConHabitual = DIAS_SEMANA.slice(0, (habitual.data ?? []).some((h) => h.diaSemana > 5) ? 7 : 5);
  const vigentes = (bloqueos.data ?? []).filter((b) => !b.fin || new Date(b.fin).getTime() > Date.now());
  const nombre = miembro.nombre ?? 'Profesional';

  return (
    <article className="rounded-lg border border-divider bg-bg px-6 py-[22px] shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Avatar name={nombre} size={38} />
        <div className="min-w-0">
          <h2 className="m-0 text-[17px] font-black tracking-[-0.02em]">{nombre}</h2>
          <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
            {miembro.roles.includes('PROFESIONAL') ? 'Profesional' : (NOMBRE_ROL[miembro.rol] ?? miembro.rol)}
          </p>
        </div>
        <span className="ml-auto text-[12.5px] font-extrabold text-neutral-800 tabular-nums">
          {bloques.isSuccess ? `${Math.round((totalMin / 60) * 10) / 10} h apartadas` : ''}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="schedule" onClick={() => setModal('habitual')} className="!py-2.5">
            Horario habitual
          </Button>
          <Button variant="secondary" icon="event_busy" onClick={() => setModal('bloquear')} className="!py-2.5">
            Bloquear agenda
          </Button>
          {esProfesional && (
            <Button variant="secondary" icon="timer" onClick={() => setModal('margen')} className="!py-2.5">
              Margen de traslado
            </Button>
          )}
          <Button variant="team" icon="add" onClick={() => setModal('apartar')} className="!py-2.5">
            Apartar horas
          </Button>
        </div>
      </div>

      {esProfesional && <AvisoConflictos profesionalId={miembro.id} onVer={() => setModal('margen')} />}
      <p className="m-0 mb-2 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Horario habitual</p>
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
        {diasConHabitual.map((d, i) => {
          const del = (habitual.data ?? []).filter((h) => h.diaSemana === i + 1);
          return (
            <div
              key={d}
              className={`rounded-[14px] border px-[13px] py-[11px] ${del.length ? 'border-accent-500 bg-accent-100' : 'border-divider bg-neutral-100'}`}
            >
              <div className="mb-1 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">{d}</div>
              <div className="text-[13.5px] font-extrabold tabular-nums">
                {del.length ? (
                  [...new Set(del.map((h) => `${h.horaInicio} – ${h.horaFin}`))].join(', ')
                ) : (
                  <span className="font-semibold text-neutral-700">No atiende</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="m-0 mb-2 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Horas de box apartadas</p>
      {bloques.isPending ? (
        <p className="m-0 text-[13px] font-semibold text-neutral-700">Cargando…</p>
      ) : (bloques.data ?? []).length === 0 ? (
        <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Sin horas apartadas esta semana: no aparece disponible para agendar.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {[...porDia.entries()].map(([d, lista]) => (
            <li key={d} className="flex flex-wrap items-center gap-2">
              <span className="w-[150px] text-[13px] font-extrabold first-letter:uppercase">{formatoFechaLarga(`${d}T12:00:00-04:00`)}</span>
              {lista.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1 rounded-full border border-divider bg-neutral-100 py-1 pr-1 pl-3 text-[12.5px] font-bold tabular-nums"
                >
                  {nombreBox.get(b.espacioId) ?? 'Box'} · {formatoHora(b.inicio)}–{formatoHora(b.fin)}
                  <button
                    type="button"
                    aria-label={`Liberar ${nombreBox.get(b.espacioId) ?? 'box'} de ${formatoHora(b.inicio)} a ${formatoHora(b.fin)}`}
                    onClick={() => liberar.mutate(b.id)}
                    className="grid size-7 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {vigentes.length > 0 && (
        <>
          <p className="m-0 mt-5 mb-2 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Agenda bloqueada</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {vigentes.map((b) => (
              <li
                key={b.id}
                className="inline-flex items-center gap-1 rounded-full border border-accent-500 bg-accent-100 py-1 pr-1 pl-3 text-[12.5px] font-bold"
              >
                {NOMBRE_MOTIVO[b.motivo]}: {formatoFecha(b.inicio)}
                {b.fin ? ` al ${formatoFecha(new Date(new Date(b.fin).getTime() - 1))}` : ' en adelante'}
                {b.motivo !== 'BAJA' && (
                  <button
                    type="button"
                    aria-label="Quitar bloqueo"
                    onClick={() => quitarBloqueo.mutate(b.id)}
                    className="grid size-7 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}

      <HorarioHabitual abierto={modal === 'habitual'} onCerrar={() => setModal(null)} profesionalId={miembro.id} nombre={nombre} filas={habitual.data ?? []} />
      <ApartarHoras
        abierto={modal === 'apartar'}
        onCerrar={() => setModal(null)}
        profesionalId={miembro.id}
        nombre={nombre}
        habitual={habitual.data ?? []}
        rangoInicial={rango}
      />
      <BloquearAgenda abierto={modal === 'bloquear'} onCerrar={() => setModal(null)} profesionalId={miembro.id} nombre={nombre} />
      {esProfesional && <MargenTraslado abierto={modal === 'margen'} onCerrar={() => setModal(null)} profesionalId={miembro.id} nombre={nombre} />}
    </article>
  );
}

/** Aviso en la tarjeta cuando hay horas que ya no cumplen el margen de traslado. */
function AvisoConflictos({ profesionalId, onVer }: { profesionalId: string; onVer: () => void }) {
  const conflictos = useConflictosMargen(profesionalId);
  const n = conflictos.data?.length ?? 0;
  if (!n) return null;
  return (
    <Aviso
      tono="advertencia"
      icono="timer"
      className="mb-4"
      accion={
        <Button variant="secondary" onClick={onVer} className="!py-2">
          Ver horas
        </Button>
      }
    >
      {n === 1 ? '1 hora no cumple el margen de traslado.' : `${n} horas no cumplen el margen de traslado.`} Reprográmalas en el calendario.
    </Aviso>
  );
}

/** Horario habitual: la plantilla con la que se apartan horas de box (no decide la agenda por si solo). */
function HorarioHabitual({
  abierto,
  onCerrar,
  profesionalId,
  nombre,
  filas,
}: {
  abierto: boolean;
  onCerrar: () => void;
  profesionalId: string;
  nombre: string;
  filas: Habitual[];
}) {
  const cliente = useQueryClient();
  const [nueva, setNueva] = useState({ dia: 1, inicio: '09:00', fin: '13:00', modalidad: 'PRESENCIAL' as Habitual['modalidad'] });
  const [error, setError] = useState<string>();
  const refrescar = () => void cliente.invalidateQueries({ queryKey: ['panel', 'habitual', profesionalId] });
  const agregar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/profesionales/{profesionalId}/disponibilidad', {
          params: { path: { profesionalId } },
          body: { diaSemana: nueva.dia, inicioMin: minutos(nueva.inicio), finMin: minutos(nueva.fin), modalidad: nueva.modalidad },
        }),
      ),
    onSuccess: () => {
      setError(undefined);
      refrescar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos agregar el horario.'),
  });
  const quitar = useMutation({
    mutationFn: (id: string) => datos(api.DELETE('/api/profesionales/{profesionalId}/disponibilidad/{id}', { params: { path: { profesionalId, id } } })),
    onSuccess: refrescar,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos quitar el horario.'),
  });
  const ordenadas = [...filas].sort((a, b) => a.diaSemana - b.diaSemana || a.inicioMin - b.inicioMin);
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      ancho="lg"
      titulo={`Horario habitual de ${nombre}`}
      descripcion="Es la plantilla para apartar horas de box: solo lo apartado queda disponible para agendar."
    >
      <div className="flex flex-col gap-4">
        {ordenadas.length === 0 ? (
          <EstadoVista estado="vacio" titulo="Sin horario habitual" mensaje="Agrega los días y horas en que suele atender." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ordenadas.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-[14px] border border-divider bg-neutral-100 px-3.5 py-2 text-[13.5px] font-bold">
                <span className="w-[100px] font-extrabold">{DIAS_SEMANA[h.diaSemana - 1]}</span>
                <span className="flex-1 tabular-nums">
                  {h.horaInicio} – {h.horaFin} · {NOMBRE_MODALIDAD_CITA[h.modalidad]}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar ${DIAS_SEMANA[h.diaSemana - 1]} ${h.horaInicio}`}
                  onClick={() => quitar.mutate(h.id)}
                  className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
                >
                  <Icon name="delete" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-neutral-400 p-3">
          <Field label="Día">
            {(p) => (
              <Select {...p} value={nueva.dia} onChange={(e) => setNueva((n) => ({ ...n, dia: Number(e.target.value) }))} className="!py-2">
                {DIAS_SEMANA.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Desde">
            {(p) => (
              <Input
                {...p}
                type="time"
                step={900}
                value={nueva.inicio}
                onChange={(e) => setNueva((n) => ({ ...n, inicio: e.target.value }))}
                className="!w-[150px] !py-2"
              />
            )}
          </Field>
          <Field label="Hasta">
            {(p) => (
              <Input
                {...p}
                type="time"
                step={900}
                value={nueva.fin}
                onChange={(e) => setNueva((n) => ({ ...n, fin: e.target.value }))}
                className="!w-[150px] !py-2"
              />
            )}
          </Field>
          <Field label="Modalidad">
            {(p) => (
              <Select
                {...p}
                value={nueva.modalidad}
                onChange={(e) => setNueva((n) => ({ ...n, modalidad: e.target.value as Habitual['modalidad'] }))}
                className="!py-2"
              >
                <option value="PRESENCIAL">Presencial</option>
                <option value="ONLINE">Online</option>
              </Select>
            )}
          </Field>
          <Button
            variant="secondary"
            icon="add"
            loading={agregar.isPending}
            onClick={() => (minutos(nueva.fin) <= minutos(nueva.inicio) ? setError('La hora de término debe ser posterior a la de inicio.') : agregar.mutate())}
            className="!py-2.5"
          >
            Agregar
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="team" onClick={onCerrar}>
            Listo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PorApartar {
  clave: string;
  espacioId: string;
  fecha: string;
  inicio: string;
  fin: string;
  /** Rango libre del box que lo contiene (minutos locales). */
  libreDesde: number;
  libreHasta: number;
}

/**
 * Apartar horas de box (todo o nada): muestra lo libre de cada box en la
 * semana y sugiere lo que calza con el horario habitual. La BD valida horario
 * del box y que no choque con otro profesional (409).
 */
function ApartarHoras({
  abierto,
  onCerrar,
  profesionalId,
  nombre,
  habitual,
  rangoInicial,
}: {
  abierto: boolean;
  onCerrar: () => void;
  profesionalId: string;
  nombre: string;
  habitual: Habitual[];
  rangoInicial: ReturnType<typeof semanaChile>;
}) {
  const cliente = useQueryClient();
  const espacios = useEspacios();
  const nombreBox = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const [lunes, setLunes] = useState(rangoInicial.lunes);
  const desde = new Date(Math.max(inicioDiaChile(lunes).getTime(), Date.now())).toISOString();
  const hasta = inicioDiaChile(sumarDias(lunes, 7)).toISOString();
  const libres = useQuery({
    queryKey: ['panel', 'espacios', 'libres', lunes],
    queryFn: () => datos(api.GET('/api/espacios/disponibilidad', { params: { query: { desde, hasta } } })),
    enabled: abierto && new Date(hasta).getTime() > Date.now(),
  });
  const [seleccion, setSeleccion] = useState<PorApartar[]>([]);
  const [error, setError] = useState<string>();

  const porDia = new Map<string, HoraLibre[]>();
  for (const l of libres.data ?? []) porDia.set(dia(new Date(l.inicio)), [...(porDia.get(dia(new Date(l.inicio))) ?? []), l]);

  const item = (l: HoraLibre, inicioMin: number, finMin: number): PorApartar => {
    const fecha = dia(new Date(l.inicio));
    return {
      clave: `${l.espacioId}-${fecha}-${inicioMin}`,
      espacioId: l.espacioId,
      fecha,
      inicio: hhmm(inicioMin),
      fin: hhmm(finMin),
      libreDesde: minutoLocal(l.inicio),
      libreHasta: minutoLocal(l.fin) || 24 * 60,
    };
  };
  const usar = (l: HoraLibre) => {
    const a = minutoLocal(l.inicio);
    const b = minutoLocal(l.fin) || 24 * 60;
    const h = habitual.find((x) => x.diaSemana === isoDow(dia(new Date(l.inicio))) && x.inicioMin < b && x.finMin > a);
    const nuevo = h ? item(l, Math.max(a, h.inicioMin), Math.min(b, h.finMin)) : item(l, a, b);
    setSeleccion((s) => (s.some((x) => x.clave === nuevo.clave) ? s : [...s, nuevo]));
  };
  const sugerir = () => {
    const nuevos: PorApartar[] = [];
    for (const h of habitual) {
      for (const [fecha, lista] of porDia) {
        if (isoDow(fecha) !== h.diaSemana) continue;
        const l = lista.find((x) => minutoLocal(x.inicio) < h.finMin && (minutoLocal(x.fin) || 1440) > h.inicioMin);
        if (l) nuevos.push(item(l, Math.max(minutoLocal(l.inicio), h.inicioMin), Math.min(minutoLocal(l.fin) || 1440, h.finMin)));
      }
    }
    // El habitual puede repetir el rango por modalidad: una sola sugerencia por box, dia y hora.
    setSeleccion((s) => [
      ...s,
      ...nuevos.filter((n, i) => nuevos.findIndex((x) => x.clave === n.clave) === i && !s.some((x) => x.fecha === n.fecha && x.inicio === n.inicio)),
    ]);
  };
  const cambiar = (clave: string, cambio: Partial<PorApartar>) => setSeleccion((s) => s.map((x) => (x.clave === clave ? { ...x, ...cambio } : x)));
  const cerrar = () => {
    setSeleccion([]);
    setError(undefined);
    onCerrar();
  };

  const apartar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/profesionales/{profesionalId}/bloques', {
          params: { path: { profesionalId } },
          body: {
            bloques: seleccion.map((s) => ({
              espacioId: s.espacioId,
              inicio: instanteChile(s.fecha, minutos(s.inicio)).toISOString(),
              fin: instanteChile(s.fecha, minutos(s.fin)).toISOString(),
            })),
          },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'bloques', profesionalId] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'espacios'] });
      void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
      cerrar();
    },
    onError: (e) => {
      void libres.refetch();
      setError(
        e instanceof ApiError && e.status === 409
          ? 'Alguien apartó una de esas horas antes, o choca con otra hora de este profesional. Revisa lo libre y vuelve a intentar.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos apartar las horas.',
      );
    },
  });
  const confirmar = () => {
    const mala = seleccion.find((s) => minutos(s.fin) <= minutos(s.inicio) || minutos(s.inicio) < s.libreDesde || minutos(s.fin) > s.libreHasta);
    if (mala)
      return setError(
        `${nombreBox.get(mala.espacioId) ?? 'El box'} el ${formatoFechaLarga(`${mala.fecha}T12:00:00-04:00`)}: la hora debe quedar dentro de ${hhmm(mala.libreDesde)} – ${hhmm(mala.libreHasta)}.`,
      );
    setError(undefined);
    apartar.mutate();
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      ancho="lg"
      titulo={`Apartar horas de box para ${nombre}`}
      descripcion="Solo las horas apartadas se ofrecen para agendar (presencial u online)."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Semana anterior"
            disabled={lunes <= semanaChile(0).lunes}
            onClick={() => setLunes((l) => sumarDias(l, -7))}
            className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200 disabled:opacity-40"
          >
            <Icon name="chevron_left" />
          </button>
          <span className="text-[13.5px] font-extrabold">Semana del {formatoFecha(lunes).replace(/ de \d{4}$/, '')}</span>
          <button
            type="button"
            aria-label="Semana siguiente"
            onClick={() => setLunes((l) => sumarDias(l, 7))}
            className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
          >
            <Icon name="chevron_right" />
          </button>
          {habitual.length > 0 && (
            <Button variant="ghost" icon="bolt" onClick={sugerir} disabled={!libres.isSuccess} className="ml-auto !py-2">
              Sugerir según horario habitual
            </Button>
          )}
        </div>

        <EstadoConsulta consulta={libres} vacio={(l) => l.length === 0} textoVacio="No quedan horas de box libres esa semana">
          {() => (
            <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pr-1">
              {[...porDia.entries()].map(([fecha, lista]) => (
                <div key={fecha} className="flex flex-wrap items-center gap-2">
                  <span className="w-[150px] text-[13px] font-extrabold first-letter:uppercase">{formatoFechaLarga(`${fecha}T12:00:00-04:00`)}</span>
                  {lista.map((l) => (
                    <button
                      key={`${l.espacioId}-${l.inicio}`}
                      type="button"
                      onClick={() => usar(l)}
                      className="cursor-pointer rounded-full border-[1.5px] border-neutral-400 bg-bg px-3 py-1.5 text-[12.5px] font-bold tabular-nums transition-colors duration-200 hover:border-accent-500 hover:bg-accent-100"
                    >
                      {nombreBox.get(l.espacioId) ?? 'Box'} · {formatoHora(l.inicio)}–{formatoHora(l.fin)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </EstadoConsulta>

        <div className="flex flex-col gap-2">
          <p className="m-0 text-[12.5px] font-extrabold">Por apartar ({seleccion.length})</p>
          {seleccion.length === 0 && <p className="m-0 text-[13px] font-semibold text-neutral-700">Elige un rango libre de arriba y ajusta las horas.</p>}
          {seleccion.map((s) => (
            <div key={s.clave} className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-accent-500 bg-accent-100 px-3.5 py-2">
              <span className="w-[200px] text-[13px] font-extrabold first-letter:uppercase">
                {nombreBox.get(s.espacioId) ?? 'Box'} · {formatoFechaLarga(`${s.fecha}T12:00:00-04:00`)}
              </span>
              <Input
                type="time"
                step={900}
                aria-label="Desde"
                value={s.inicio}
                onChange={(e) => cambiar(s.clave, { inicio: e.target.value })}
                className="!w-[150px] !py-2"
              />
              <span className="text-[13px] font-bold text-neutral-700">a</span>
              <Input
                type="time"
                step={900}
                aria-label="Hasta"
                value={s.fin}
                onChange={(e) => cambiar(s.clave, { fin: e.target.value })}
                className="!w-[150px] !py-2"
              />
              <button
                type="button"
                aria-label="Quitar"
                onClick={() => setSeleccion((l) => l.filter((x) => x.clave !== s.clave))}
                className="ml-auto grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={cerrar}>
            Cancelar
          </Button>
          <Button variant="team" icon="check" disabled={seleccion.length === 0} loading={apartar.isPending} onClick={confirmar}>
            Apartar {seleccion.length > 1 ? `${seleccion.length} bloques` : 'horas'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Bloqueo de agenda (vacaciones, licencia, personal): resta horas sin liberar el box. La baja la registra administracion aparte. */
function BloquearAgenda({ abierto, onCerrar, profesionalId, nombre }: { abierto: boolean; onCerrar: () => void; profesionalId: string; nombre: string }) {
  const cliente = useQueryClient();
  const hoy = dia(new Date());
  const [motivo, setMotivo] = useState<'VACACIONES' | 'LICENCIA' | 'PERSONAL'>('VACACIONES');
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(sumarDias(hoy, 6));
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/profesionales/{profesionalId}/bloqueos', {
          params: { path: { profesionalId } },
          body: { motivo, inicio: inicioDiaChile(desde).toISOString(), fin: inicioDiaChile(sumarDias(hasta, 1)).toISOString() },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'bloqueos', profesionalId] });
      void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
      setError(undefined);
      onCerrar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos bloquear la agenda.'),
  });
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Bloquear agenda de ${nombre}`}
      descripcion="En esos días no se ofrecen horas. Las citas ya agendadas no se mueven solas: reprográmalas."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (hasta < desde) return setError('La fecha de término debe ser igual o posterior a la de inicio.');
          crear.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Motivo" required>
          {(p) => (
            <Select {...p} value={motivo} onChange={(e) => setMotivo(e.target.value as typeof motivo)}>
              <option value="VACACIONES">Vacaciones</option>
              <option value="LICENCIA">Licencia</option>
              <option value="PERSONAL">Personal</option>
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Desde" required>
            {(p) => <Input {...p} type="date" min={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} />}
          </Field>
          <Field label="Hasta (inclusive)" required>
            {(p) => <Input {...p} type="date" min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} />}
          </Field>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" variant="team" loading={crear.isPending}>
            Bloquear
          </Button>
        </div>
      </form>
    </Modal>
  );
}
