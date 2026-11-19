'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useHorarioCentro } from '@/lib/centro';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFecha, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { horaFinCentro, horaInicioCentro } from '@/lib/grillaAgenda';
import { dia } from '@/lib/horarios';
import { inicioDiaChile, instanteChile, semanaChile, sumarDias, useEquipoAgenda, useEspacios, type MiembroDirectorio } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { NOMBRE_MODALIDAD_CITA } from '@/components/shared/SelectorHorario';
import { DIAS_SEMANA, hhmm, minutos } from './tonosAgenda';

type Habitual = components['schemas']['DisponibilidadHabitual'];
type Bloque = components['schemas']['BloqueAtencionVista'];
type Bloqueo = components['schemas']['BloqueoAgendaVista'];

const NOMBRE_ROL: Partial<Record<string, string>> = { PROFESIONAL: 'Profesional', PRACTICANTE: 'Practicante' };
const NOMBRE_MOTIVO: Record<Bloqueo['motivo'], string> = { VACACIONES: 'Vacaciones', LICENCIA: 'Licencia', PERSONAL: 'Personal', BAJA: 'Baja' };
const isoDow = (fecha: string) => ((new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

const claveBloques = (profesionalId: string, desde: string) => ['panel', 'bloques', profesionalId, desde];

/**
 * Pestaña "Horarios del equipo" (diseño "Agenda y Espacios"). 2026-11-18: el
 * horario del profesional decide la agenda: online sale de su horario online
 * (sin box); presencial, de las horas de box apartadas (`bloques_atencion`)
 * dentro de su horario presencial. Todo dentro del horario del centro; los
 * bloqueos (vacaciones, licencia) restan horas. ADMIN/GESTION ven
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
        {() => visibles.map((m) => <TarjetaHorario key={m.id} miembro={m} rango={rango} madre={rol === 'ADMIN'} />)}
      </EstadoConsulta>
    </div>
  );
}

function TarjetaHorario({ miembro, rango, madre }: { miembro: MiembroDirectorio; rango: ReturnType<typeof semanaChile>; madre: boolean }) {
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
  const [modal, setModal] = useState<'apartar' | 'bloquear' | null>(null);
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
  const vigentes = (bloqueos.data ?? []).filter((b) => !b.fin || new Date(b.fin).getTime() > Date.now());
  const nombre = miembro.nombre ?? 'Profesional';

  return (
    <article className="rounded-lg border border-divider bg-bg px-6 py-[22px] shadow-suave">
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
          <Button variant="secondary" icon="event_busy" onClick={() => setModal('bloquear')} className="!py-2.5">
            Días sin atención
          </Button>
          <Button variant="team" icon="add" onClick={() => setModal('apartar')} className="!py-2.5">
            Apartar horas
          </Button>
        </div>
      </div>

      <HorarioAtencion profesionalId={miembro.id} filas={habitual.data ?? []} cargando={habitual.isPending} />

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
                {b.fin ? ` al ${formatoFecha(new Date(new Date(b.fin).getTime() - 1))}` : ' en adelante (no atiende)'}
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

      <ApartarHoras
        abierto={modal === 'apartar'}
        onCerrar={() => setModal(null)}
        profesionalId={miembro.id}
        nombre={nombre}
        habitual={habitual.data ?? []}
        rangoInicial={rango}
      />
      <BloquearAgenda abierto={modal === 'bloquear'} onCerrar={() => setModal(null)} profesionalId={miembro.id} nombre={nombre} madre={madre} />
    </article>
  );
}

type ModalidadHorario = Habitual['modalidad'] | 'AMBAS';
const MODALIDADES_HORARIO = [
  { valor: 'AMBAS', etiqueta: 'Ambas' },
  { valor: 'PRESENCIAL', etiqueta: 'Presencial', icono: 'meeting_room' },
  { valor: 'ONLINE', etiqueta: 'Online', icono: 'videocam' },
] as const;
const CHIP_MODALIDAD: Record<Habitual['modalidad'], string> = {
  PRESENCIAL: 'border-presencial-600 bg-presencial-200 text-presencial-900',
  ONLINE: 'border-online-600 bg-online-100 text-online-900',
};
const LABORALES = [1, 2, 3, 4, 5];

/**
 * Horario de atencion del profesional (diseño "Horario de atención"; 2026-11-18: decide la agenda). Se edita en la
 * misma tarjeta, dia por dia: online se ofrece tal cual; presencial, en las horas de box apartadas dentro de el.
 */
function HorarioAtencion({ profesionalId, filas, cargando }: { profesionalId: string; filas: Habitual[]; cargando: boolean }) {
  const cliente = useQueryClient();
  const centro = useHorarioCentro().data;
  const [diaAbierto, setDiaAbierto] = useState<number | null>(null);
  const [form, setForm] = useState({ inicio: '09:00', fin: '13:00', modalidad: 'AMBAS' as ModalidadHorario, laborales: false });
  const [error, setError] = useState<string>();
  const refrescar = () => {
    void cliente.invalidateQueries({ queryKey: ['panel', 'habitual', profesionalId] });
    void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
  };
  const agregar = useMutation({
    mutationFn: () => {
      const dias = form.laborales ? LABORALES : [diaAbierto!];
      const modalidades: Habitual['modalidad'][] = form.modalidad === 'AMBAS' ? ['PRESENCIAL', 'ONLINE'] : [form.modalidad];
      return Promise.all(
        dias.flatMap((d) =>
          modalidades.map((modalidad) =>
            datos(
              api.POST('/api/profesionales/{profesionalId}/disponibilidad', {
                params: { path: { profesionalId } },
                body: { diaSemana: d, inicioMin: minutos(form.inicio), finMin: minutos(form.fin), modalidad },
              }),
            ),
          ),
        ),
      );
    },
    onSuccess: () => {
      setError(undefined);
      setDiaAbierto(null);
      refrescar();
    },
    onError: (e) => {
      refrescar();
      setError(e instanceof ApiError ? e.message : 'No pudimos agregar el horario.');
    },
  });
  // Quitar un horario deja por reprogramar las sesiones futuras que quedan fuera (la BD avisa a cada paciente).
  const [porQuitar, setPorQuitar] = useState<Habitual | null>(null);
  const quitar = useMutation({
    mutationFn: (id: string) => datos(api.DELETE('/api/profesionales/{profesionalId}/disponibilidad/{id}', { params: { path: { profesionalId, id } } })),
    onSuccess: () => {
      setPorQuitar(null);
      refrescar();
      void cliente.invalidateQueries({ queryKey: ['panel'] });
    },
    onError: (e) => {
      setPorQuitar(null);
      setError(e instanceof ApiError ? e.message : 'No pudimos quitar el horario.');
    },
  });
  // 2026-11-18: apagar o encender un dia entero con un clic (sus horas se guardan). Apagar reprograma (la BD avisa).
  const [porApagar, setPorApagar] = useState<number | null>(null);
  const cambiarDia = useMutation({
    mutationFn: ({ dia, activo }: { dia: number; activo: boolean }) =>
      datos(api.PATCH('/api/profesionales/{profesionalId}/disponibilidad/dias/{dia}', { params: { path: { profesionalId, dia } }, body: { activo } })),
    onSuccess: () => {
      setPorApagar(null);
      refrescar();
      void cliente.invalidateQueries({ queryKey: ['panel'] });
    },
    onError: (e) => {
      setPorApagar(null);
      setError(e instanceof ApiError ? e.message : 'No pudimos cambiar el día.');
    },
  });
  // Fin de semana solo si el centro atiende esos dias o ya hay horario cargado.
  const dias = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5 || filas.some((h) => h.diaSemana === d) || (centro ?? []).some((h) => h.diaSemana === d));
  const abrir = (d: number) => {
    setError(undefined);
    setForm((f) => ({ ...f, laborales: false }));
    setDiaAbierto((a) => (a === d ? null : d));
  };
  const guardar = () => {
    if (minutos(form.fin) <= minutos(form.inicio)) return setError('La hora de término debe ser posterior a la de inicio.');
    agregar.mutate();
  };

  return (
    <section aria-labelledby={`horario-${profesionalId}`} className="mb-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`horario-${profesionalId}`} className="m-0 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">
          Horario de atención
        </h3>
        <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
          Sobre este horario se calcula la disponibilidad: online se ofrece tal cual; presencial, en tus horas de box dentro de él.
        </p>
      </div>
      {cargando ? (
        <p className="m-0 text-[13px] font-semibold text-neutral-700">Cargando…</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-divider rounded-[14px] border border-divider bg-bg p-0">
          {dias.map((d) => {
            const del = filas.filter((h) => h.diaSemana === d).sort((a, b) => a.inicioMin - b.inicioMin || a.modalidad.localeCompare(b.modalidad));
            const nombreDia = DIAS_SEMANA[d - 1]!;
            const encendido = del.some((h) => h.activo);
            return (
              <li key={d} className="px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-[150px] flex-none">
                    <Interruptor
                      etiqueta={nombreDia}
                      activo={encendido}
                      deshabilitado={del.length === 0 || cambiarDia.isPending}
                      tono="team"
                      onChange={(v) => (v ? cambiarDia.mutate({ dia: d, activo: true }) : setPorApagar(d))}
                    />
                  </div>
                  <div className={`flex min-w-0 flex-1 flex-wrap items-center gap-1.5 ${del.length > 0 && !encendido ? 'opacity-55' : ''}`}>
                    {del.length === 0 && <span className="py-1 text-[13px] font-semibold text-neutral-700">No atiende</span>}
                    {del.length > 0 && !encendido && <span className="py-1 text-[12.5px] font-extrabold text-neutral-800">Apagado (horario guardado):</span>}
                    {del.map((h) => (
                      <span
                        key={h.id}
                        className={`inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5 text-[12.5px] font-bold tabular-nums ${CHIP_MODALIDAD[h.modalidad]}`}
                      >
                        <Icon name={h.modalidad === 'ONLINE' ? 'videocam' : 'meeting_room'} size={15} />
                        {h.horaInicio}–{h.horaFin}
                        <span className="sr-only"> {NOMBRE_MODALIDAD_CITA[h.modalidad]}</span>
                        <button
                          type="button"
                          aria-label={`Quitar ${NOMBRE_MODALIDAD_CITA[h.modalidad].toLowerCase()} del ${nombreDia.toLowerCase()} ${h.horaInicio} a ${h.horaFin}`}
                          onClick={() => setPorQuitar(h)}
                          className="grid size-7 cursor-pointer place-items-center rounded-full hover:bg-bg/70"
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    icon={diaAbierto === d ? 'close' : 'add'}
                    aria-expanded={diaAbierto === d}
                    aria-label={diaAbierto === d ? `Cerrar agregar horario del ${nombreDia.toLowerCase()}` : `Agregar horario el ${nombreDia.toLowerCase()}`}
                    onClick={() => abrir(d)}
                    className="!px-3 !py-1.5 !text-[12.5px]"
                  >
                    {diaAbierto === d ? 'Cerrar' : 'Agregar'}
                  </Button>
                </div>
                {diaAbierto === d && (
                  <form
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      guardar();
                    }}
                    className="mt-2 flex flex-wrap items-end gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-neutral-400 p-3"
                  >
                    <Field label="Desde">
                      {(p) => (
                        <Input
                          {...p}
                          type="time"
                          step={900}
                          value={form.inicio}
                          onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value }))}
                          className="!w-[130px] !py-2"
                        />
                      )}
                    </Field>
                    <Field label="Hasta">
                      {(p) => (
                        <Input
                          {...p}
                          type="time"
                          step={900}
                          value={form.fin}
                          onChange={(e) => setForm((f) => ({ ...f, fin: e.target.value }))}
                          className="!w-[130px] !py-2"
                        />
                      )}
                    </Field>
                    <ControlSegmentado
                      etiqueta="Modalidad"
                      conLeyenda
                      compacto
                      tono="team"
                      opciones={MODALIDADES_HORARIO}
                      valor={form.modalidad}
                      onChange={(modalidad) => setForm((f) => ({ ...f, modalidad }))}
                    />
                    {d <= 5 && (
                      <label className="flex cursor-pointer items-center gap-2 py-2 text-[13px] font-bold">
                        <input
                          type="checkbox"
                          checked={form.laborales}
                          onChange={(e) => setForm((f) => ({ ...f, laborales: e.target.checked }))}
                          className="size-[18px] cursor-pointer accent-accent-700"
                        />
                        Repetir de lunes a viernes
                      </label>
                    )}
                    <Button type="submit" variant="team" icon="check" loading={agregar.isPending} className="ml-auto !py-2.5">
                      Guardar
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <Modal
        abierto={!!porQuitar}
        onCerrar={() => setPorQuitar(null)}
        titulo="¿Quitar este horario?"
        descripcion={
          porQuitar
            ? `${DIAS_SEMANA[porQuitar.diaSemana - 1]} ${porQuitar.horaInicio}–${porQuitar.horaFin}, ${NOMBRE_MODALIDAD_CITA[porQuitar.modalidad].toLowerCase()}. Las sesiones futuras que queden fuera de tu horario pasan a «por reprogramar» y cada paciente recibe un aviso para pedir otra hora contigo, cancelar o atenderse con otro profesional mientras tanto. Las sesiones pasadas no cambian.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setPorQuitar(null)}>
            Cancelar
          </Button>
          <Button variant="team" icon="delete" loading={quitar.isPending} onClick={() => porQuitar && quitar.mutate(porQuitar.id)}>
            Quitar horario
          </Button>
        </div>
      </Modal>
      <Modal
        abierto={porApagar !== null}
        onCerrar={() => setPorApagar(null)}
        titulo={porApagar ? `¿Apagar el ${DIAS_SEMANA[porApagar - 1]!.toLowerCase()}?` : ''}
        descripcion="Ese día deja de ofrecer horas (presencial y online) y su horario queda guardado para volver a encenderlo. Las sesiones futuras de ese día pasan a «por reprogramar» y cada paciente recibe un aviso para pedir otra hora contigo, cancelar o atenderse con otro profesional mientras tanto. Las sesiones pasadas no cambian."
      >
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setPorApagar(null)}>
            Cancelar
          </Button>
          <Button variant="team" icon="event_busy" loading={cambiarDia.isPending} onClick={() => porApagar && cambiarDia.mutate({ dia: porApagar, activo: false })}>
            Apagar día
          </Button>
        </div>
      </Modal>
    </section>
  );
}

type EstadoCelda = 'libre' | 'marcada' | 'tuya' | 'otroBox' | 'ocupado' | 'cerrado' | 'pasada';
const TEXTO_CELDA: Record<EstadoCelda, string> = {
  libre: 'Libre',
  marcada: 'Marcada',
  tuya: 'Apartada',
  otroBox: 'En otro box',
  ocupado: 'Ocupado',
  cerrado: 'Box cerrado',
  pasada: 'Pasada',
};
const CLASE_CELDA: Record<EstadoCelda, string> = {
  libre:
    'cursor-pointer border-[1.5px] border-dashed border-neutral-400 bg-bg text-neutral-800 hover:border-accent-600 hover:bg-accent-100 focus-visible:outline-2 focus-visible:outline-accent-700',
  marcada: 'cursor-pointer border-[1.5px] border-accent-700 bg-accent-700 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
  tuya: 'border border-presencial-600 bg-presencial-200 text-presencial-900',
  otroBox: 'border border-neutral-400 bg-neutral-200 text-neutral-800',
  ocupado: 'border border-neutral-500 bg-neutral-300/70 text-neutral-900',
  cerrado: 'bg-neutral-100 text-neutral-700',
  pasada: 'bg-neutral-100 text-neutral-700',
};
const cabeceraDia = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });

/** Horas marcadas de un dia -> bloques continuos (una hora seguida de otra se aparta como un solo bloque). */
export function unirHoras(horas: number[]): { desde: number; hasta: number }[] {
  const salida: { desde: number; hasta: number }[] = [];
  for (const h of [...new Set(horas)].sort((a, b) => a - b)) {
    const ultimo = salida.at(-1);
    if (ultimo && ultimo.hasta === h) ultimo.hasta = h + 1;
    else salida.push({ desde: h, hasta: h + 1 });
  }
  return salida;
}

/**
 * Apartar horas de box (todo o nada) en una grilla semanal: un box, dias en columnas y horas del centro en filas.
 * Cada hora libre es un boton (clic o teclado) que se marca; las horas seguidas de un dia se apartan como un solo
 * bloque. Se ve que esta ocupado, lo ya apartado y la hora en que el profesional ya tiene otro box (el EXCLUDE no
 * permite dos a la vez). "Sugerir" marca lo libre dentro de su horario presencial. La BD valida igual (409/422).
 * ponytail: celdas de una hora en punto; un tramo libre que empieza a la media hora no se puede marcar.
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
  const activos = (espacios.data ?? []).filter((e) => e.activo);
  const [boxElegido, setBoxElegido] = useState<string | null>(null);
  const box = boxElegido ?? activos[0]?.id ?? null;
  const nombreBox = activos.find((e) => e.id === box)?.nombre ?? 'Box';
  const centro = useHorarioCentro().data;
  const desdeHora = horaInicioCentro(centro);
  const hastaHora = horaFinCentro(centro);
  const [lunes, setLunes] = useState(rangoInicial.lunes);
  const desde = new Date(Math.max(inicioDiaChile(lunes).getTime(), Date.now())).toISOString();
  const hasta = inicioDiaChile(sumarDias(lunes, 7)).toISOString();
  const futura = new Date(hasta).getTime() > Date.now();
  const libres = useQuery({
    queryKey: ['panel', 'espacios', 'libres', lunes],
    queryFn: () => datos(api.GET('/api/espacios/disponibilidad', { params: { query: { desde, hasta } } })),
    enabled: abierto && futura,
  });
  const propios = useQuery({
    queryKey: claveBloques(profesionalId, inicioDiaChile(lunes).toISOString()),
    queryFn: () =>
      datos(
        api.GET('/api/profesionales/{profesionalId}/bloques', {
          params: { path: { profesionalId }, query: { desde: inicioDiaChile(lunes).toISOString(), hasta } },
        }),
      ),
    enabled: abierto,
  });
  // Lo apartado por cualquiera (bloques y reservas en curso, sin quien): ocupado, haya o no sesion.
  const ocupacion = useQuery({
    queryKey: ['panel', 'espacios', 'ocupacion', desde, hasta],
    queryFn: () => datos(api.GET('/api/espacios/ocupacion', { params: { query: { desde, hasta } } })),
    enabled: abierto && futura,
  });
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();

  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)).filter(
    (f) => isoDow(f) <= 5 || (centro ?? []).some((h) => h.diaSemana === isoDow(f)) || (libres.data ?? []).some((l) => dia(new Date(l.inicio)) === f),
  );
  const horas = Array.from({ length: Math.max(0, hastaHora - desdeHora) }, (_, i) => desdeHora + i);
  const clave = (f: string, h: number) => `${f}|${h}`;
  const ahora = Date.now();
  const estado = (f: string, h: number): EstadoCelda => {
    const inicio = instanteChile(f, h * 60).getTime();
    const fin = inicio + 3_600_000;
    if (inicio <= ahora) return 'pasada';
    const choca = (propios.data ?? []).filter((b) => new Date(b.inicio).getTime() < fin && new Date(b.fin).getTime() > inicio);
    if (choca.some((b) => b.espacioId === box)) return 'tuya';
    if (choca.length) return 'otroBox';
    const libre = (libres.data ?? []).some((l) => l.espacioId === box && new Date(l.inicio).getTime() <= inicio && new Date(l.fin).getTime() >= fin);
    if (libre) return marcadas.has(clave(f, h)) ? 'marcada' : 'libre';
    const ocupada = (ocupacion.data ?? []).some((o) => o.espacio_id === box && new Date(o.inicio).getTime() < fin && new Date(o.fin).getTime() > inicio);
    return ocupada ? 'ocupado' : 'cerrado';
  };
  // Nombre del box donde el profesional ya tiene esa hora.
  const otroBoxDe = (f: string, h: number) => {
    const inicio = instanteChile(f, h * 60).getTime();
    const b = (propios.data ?? []).find((x) => new Date(x.inicio).getTime() < inicio + 3_600_000 && new Date(x.fin).getTime() > inicio);
    return (espacios.data ?? []).find((e) => e.id === b?.espacioId)?.nombre ?? 'otro box';
  };
  const alternar = (f: string, h: number) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (!n.delete(clave(f, h))) n.add(clave(f, h));
      return n;
    });
  const presencial = habitual.filter((h) => h.modalidad === 'PRESENCIAL' && h.activo);
  const sugerir = () =>
    setMarcadas((m) => {
      const n = new Set(m);
      for (const f of dias)
        for (const h of horas)
          if (estado(f, h) === 'libre' && presencial.some((x) => x.diaSemana === isoDow(f) && x.inicioMin <= h * 60 && x.finMin >= (h + 1) * 60))
            n.add(clave(f, h));
      return n;
    });
  const elegirBox = (id: string) => {
    setBoxElegido(id);
    setMarcadas(new Set());
    setError(undefined);
  };
  const moverSemana = (d: number) => {
    setLunes((l) => sumarDias(l, d * 7));
    setMarcadas(new Set());
  };
  const cerrar = () => {
    setMarcadas(new Set());
    setError(undefined);
    onCerrar();
  };

  const porDia = new Map<string, number[]>();
  for (const k of marcadas) {
    const [f, h] = k.split('|');
    porDia.set(f!, [...(porDia.get(f!) ?? []), Number(h)]);
  }
  const bloquesNuevos = [...porDia.entries()].flatMap(([f, hs]) =>
    unirHoras(hs).map((t) => ({ espacioId: box!, inicio: instanteChile(f, t.desde * 60).toISOString(), fin: instanteChile(f, t.hasta * 60).toISOString() })),
  );

  const apartar = useMutation({
    mutationFn: () => datos(api.POST('/api/profesionales/{profesionalId}/bloques', { params: { path: { profesionalId } }, body: { bloques: bloquesNuevos } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'bloques', profesionalId] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'espacios'] });
      void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
      cerrar();
    },
    onError: (e) => {
      void libres.refetch();
      void propios.refetch();
      setError(
        e instanceof ApiError && e.cuerpo.restriccion === 'bloques_atencion_sin_choque_profesional'
          ? 'Una de esas horas choca con otro box que este profesional ya tiene apartado. Revisa la grilla.'
          : e instanceof ApiError && e.status === 409
          ? 'Otro profesional apartó una de esas horas recién. Revisa la grilla y vuelve a intentar.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos apartar las horas.',
      );
    },
  });

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      ancho="xl"
      titulo={`Apartar horas de box para ${nombre}`}
      descripcion="Marca las horas libres del box (clic o teclado). Las presenciales solo se ofrecen en horas de box apartadas; las online salen del horario de atención."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[220px]">
            <Field label="Box">
              {(p) => (
                <Select {...p} value={box ?? ''} onChange={(e) => elegirBox(e.target.value)} className="!py-2">
                  {activos.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Semana anterior"
              disabled={lunes <= semanaChile(0).lunes}
              onClick={() => moverSemana(-1)}
              className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200 disabled:cursor-default disabled:opacity-40"
            >
              <Icon name="chevron_left" />
            </button>
            <span className="min-w-[150px] text-center text-[13.5px] font-extrabold" aria-live="polite">
              Semana del {formatoFecha(lunes).replace(/ de \d{4}$/, '')}
            </span>
            <button
              type="button"
              aria-label="Semana siguiente"
              onClick={() => moverSemana(1)}
              className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
            >
              <Icon name="chevron_right" />
            </button>
          </div>
          <Button
            variant="ghost"
            icon="bolt"
            onClick={sugerir}
            disabled={!libres.isSuccess || !propios.isSuccess || presencial.length === 0}
            title={presencial.length === 0 ? 'Primero agrega horario presencial en «Horario de atención»' : undefined}
            className="ml-auto !py-2"
          >
            Sugerir según horario presencial
          </Button>
        </div>

        <ul aria-label="Leyenda" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] font-bold text-neutral-800">
          {(['libre', 'marcada', 'tuya', 'otroBox', 'ocupado', 'cerrado'] as const).map((e) => (
            <li key={e} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`inline-block h-3.5 w-5 rounded-[5px] ${CLASE_CELDA[e]}`} />
              {e === 'otroBox' ? 'Ya tiene otro box a esa hora' : e === 'ocupado' ? 'Ocupado (apartado por otro)' : TEXTO_CELDA[e]}
            </li>
          ))}
        </ul>

        {!box ? (
          <EstadoVista estado="vacio" titulo="No hay boxes activos" mensaje="Administración debe crear o activar un box en «Espacios»." />
        ) : !futura ? (
          <EstadoVista estado="vacio" titulo="Semana pasada" mensaje="Avanza a una semana actual o futura." />
        ) : (
          <EstadoConsulta consulta={libres}>
            {() => (
              <div className="max-h-[min(52vh,460px)] overflow-auto rounded-[14px] border border-divider max-[860px]:max-h-[40vh]">
                <table className="w-full border-separate border-spacing-1 text-[11.5px]">
                  <caption className="sr-only">
                    Horas del {nombreBox} en la semana del {formatoFecha(lunes)}
                  </caption>
                  <thead className="sticky top-0 z-10 bg-bg">
                    <tr>
                      <th scope="col" className="w-[52px]">
                        <span className="sr-only">Hora</span>
                      </th>
                      {dias.map((f) => (
                        <th key={f} scope="col" className="py-1 text-[12px] font-extrabold first-letter:uppercase">
                          {cabeceraDia.format(new Date(`${f}T12:00:00Z`))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {horas.map((h) => (
                      <tr key={h}>
                        <th scope="row" className="pr-1 text-right text-[11.5px] font-bold text-neutral-700 tabular-nums">
                          {hhmm(h * 60)}
                        </th>
                        {dias.map((f) => {
                          const e = estado(f, h);
                          const texto = e === 'otroBox' ? `En ${otroBoxDe(f, h)}` : TEXTO_CELDA[e];
                          const etiqueta = `${nombreBox}, ${formatoFechaLarga(`${f}T12:00:00-04:00`)} de ${hhmm(h * 60)} a ${hhmm((h + 1) * 60)}: ${texto}`;
                          const clic = e === 'libre' || e === 'marcada';
                          return (
                            <td key={f} className="p-0">
                              {clic ? (
                                <button
                                  type="button"
                                  aria-pressed={e === 'marcada'}
                                  aria-label={etiqueta}
                                  onClick={() => alternar(f, h)}
                                  className={`flex h-8 w-full items-center justify-center gap-1 rounded-[8px] font-bold transition-colors duration-150 motion-reduce:transition-none ${CLASE_CELDA[e]}`}
                                >
                                  {e === 'marcada' && <Icon name="check" size={15} />}
                                  <span aria-hidden="true">{TEXTO_CELDA[e]}</span>
                                </button>
                              ) : (
                                <span
                                  title={etiqueta}
                                  className={`flex h-8 w-full items-center justify-center rounded-[8px] font-bold ${CLASE_CELDA[e]}`}
                                >
                                  <span className="sr-only">{etiqueta}</span>
                                  <span aria-hidden="true" className="truncate px-1">
                                    {e === 'pasada' ? '' : texto}
                                  </span>
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EstadoConsulta>
        )}

        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <p className="m-0 mr-auto text-[13px] font-bold text-neutral-800" aria-live="polite">
            {marcadas.size === 0
              ? 'Ninguna hora marcada.'
              : `${marcadas.size} ${marcadas.size === 1 ? 'hora marcada' : 'horas marcadas'} · se apartan como ${bloquesNuevos.length} ${bloquesNuevos.length === 1 ? 'bloque' : 'bloques'}.`}
          </p>
          {marcadas.size > 0 && (
            <Button variant="ghost" onClick={() => setMarcadas(new Set())}>
              Desmarcar todo
            </Button>
          )}
          <Button variant="ghost" onClick={cerrar}>
            Cancelar
          </Button>
          <Button variant="team" icon="check" disabled={marcadas.size === 0} loading={apartar.isPending} onClick={() => apartar.mutate()}>
            Apartar {marcadas.size > 0 ? `${marcadas.size} ${marcadas.size === 1 ? 'hora' : 'horas'}` : 'horas'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Bloqueo de agenda (vacaciones, licencia, personal): resta horas sin liberar el box. La baja la registra administracion aparte. */
/**
 * Punto 9: el bloqueo reprograma las citas que caen dentro y avisa a cada
 * paciente (elige otra hora, cancelar o atencion temporal con otro
 * profesional). La causa es administrativa, nunca un diagnostico. La cuenta
 * madre puede indicar que no atendera mas (sin fecha de termino): el sitio
 * publico deja de ofrecer horas con el y sus pacientes pasan a por reasignar.
 */
function BloquearAgenda({
  abierto,
  onCerrar,
  profesionalId,
  nombre,
  madre,
}: {
  abierto: boolean;
  onCerrar: () => void;
  profesionalId: string;
  nombre: string;
  madre: boolean;
}) {
  const cliente = useQueryClient();
  const hoy = dia(new Date());
  const [motivo, setMotivo] = useState<'VACACIONES' | 'LICENCIA' | 'PERSONAL'>('VACACIONES');
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(sumarDias(hoy, 6));
  const [indefinido, setIndefinido] = useState(false);
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/profesionales/{profesionalId}/bloqueos', {
          params: { path: { profesionalId } },
          body: {
            motivo,
            inicio: indefinido && desde === hoy ? new Date().toISOString() : inicioDiaChile(desde).toISOString(),
            fin: indefinido ? undefined : inicioDiaChile(sumarDias(hasta, 1)).toISOString(),
          },
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
      titulo={`Días sin atención de ${nombre}`}
      descripcion="En esos días no se ofrecen horas. Las sesiones futuras que caen dentro (las pasadas no cambian) pasan a «por reprogramar» y cada paciente recibe un aviso para elegir otra hora, cancelar o atenderse con otro profesional mientras tanto."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!indefinido && hasta < desde) return setError('La fecha de término debe ser igual o posterior a la de inicio.');
          crear.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Causa" required hint="Administrativa: no escribas diagnósticos.">
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
          {!indefinido && (
            <Field label="Hasta (inclusive)" required>
              {(p) => <Input {...p} type="date" min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} />}
            </Field>
          )}
        </div>
        {madre && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-divider bg-bg px-4 py-3 text-[13.5px] font-semibold">
            <input
              type="checkbox"
              checked={indefinido}
              onChange={(e) => setIndefinido(e.target.checked)}
              className="mt-0.5 size-[18px] flex-none cursor-pointer accent-accent-700"
            />
            <span>
              <strong>No atenderá más (sin fecha de término).</strong> El sitio del centro deja de ofrecer horas con {nombre} y sus pacientes quedan en
              «Pacientes por reasignar». Se revierte quitando el bloqueo.
            </span>
          </label>
        )}
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
            {indefinido ? 'Indicar que no atenderá más' : 'Bloquear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
