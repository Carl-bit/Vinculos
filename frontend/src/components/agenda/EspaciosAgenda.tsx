'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFecha } from '@/lib/formato';
import { semanaChile, useEspacios, type EspacioVista } from '@/lib/panel';

import { DIAS_SEMANA, hhmm, minutos, tonoDe } from './tonosAgenda';

type HorarioEspacio = components['schemas']['HorarioEspacioVista'];
type BloqueEspacio = components['schemas']['BloqueEspacioDto'];

const DURACIONES = [45, 50, 60, 90];
const DIA_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Bloques del horario que rigen en algun dia de la semana [lunes, domingo]. */
const rigeEnSemana = (h: HorarioEspacio, lunes: string, domingo: string) =>
  (!h.vigenteDesde || h.vigenteDesde <= domingo) && (!h.vigenteHasta || h.vigenteHasta >= lunes);

/** "Lun a Vie · 09:00 – 20:00" si el horario base es parejo; si no, los dias que abre. */
function resumenHorario(horario: HorarioEspacio[]): string {
  const base = horario.filter((h) => !h.vigenteDesde && !h.vigenteHasta).sort((a, b) => a.diaSemana - b.diaSemana || a.inicioMin - b.inicioMin);
  if (base.length === 0) return horario.length ? 'Solo por periodo' : 'Sin horario';
  const dias = [...new Set(base.map((h) => h.diaSemana))];
  const rangos = new Set(base.map((h) => `${hhmm(h.inicioMin)} – ${hhmm(h.finMin)}`));
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1]! + 1);
  const textoDias = seguidos && dias.length > 2 ? `${DIA_CORTO[dias[0]! - 1]} a ${DIA_CORTO[dias.at(-1)! - 1]}` : dias.map((d) => DIA_CORTO[d - 1]).join(', ');
  return rangos.size === 1 ? `${textoDias} · ${[...rangos][0]}` : `${textoDias} · varía por día`;
}

/**
 * Pestaña Espacios (diseño "Agenda y Espacios"): boxes con su horario de
 * funcionamiento, duracion sugerida y el porcentaje apartado de la semana
 * (horas de box apartadas por profesionales ÷ horas abiertas, como en el
 * dashboard). Crear y editar: ADMIN/GESTION.
 */
export function EspaciosAgenda({ puedeEditar, nuevo, onNuevoCerrado }: { puedeEditar: boolean; nuevo: boolean; onNuevoCerrado: () => void }) {
  const espacios = useEspacios();
  const semana = semanaChile(0);
  const domingo = semana.dias[6]!;
  const horarios = useQueries({
    queries: (espacios.data ?? []).map((e) => ({
      queryKey: ['panel', 'espacios', e.id, 'horario'],
      queryFn: () => datos(api.GET('/api/espacios/{id}/horario', { params: { path: { id: e.id } } })),
      staleTime: 5 * 60_000,
    })),
  });
  const ocupacion = useQuery({
    queryKey: ['panel', 'espacios', 'ocupacion', semana.desde],
    queryFn: () => datos(api.GET('/api/espacios/ocupacion', { params: { query: { desde: semana.desde, hasta: semana.hasta } } })),
  });
  const [editando, setEditando] = useState<EspacioVista | null>(null);
  const orden = (espacios.data ?? []).map((e) => e.id);

  return (
    <div className="flex flex-col gap-3.5">
      <EstadoConsulta consulta={espacios} vacio={(l) => l.length === 0} textoVacio="Todavía no hay espacios">
        {(lista) =>
          lista.map((e, i) => {
            const horario = horarios[i]?.data ?? [];
            const abiertoMin = horario.filter((h) => rigeEnSemana(h, semana.lunes, domingo)).reduce((s, h) => s + h.finMin - h.inicioMin, 0);
            const ocupadoMin = (ocupacion.data ?? [])
              .filter((o) => o.espacio_id === e.id)
              .reduce((s, o) => s + (new Date(o.fin).getTime() - new Date(o.inicio).getTime()) / 60_000, 0);
            const pct = abiertoMin ? Math.min(100, Math.round((ocupadoMin / abiertoMin) * 100)) : 0;
            const tono = tonoDe(orden, e.id);
            return (
              <article
                key={e.id}
                className={`flex flex-wrap items-center gap-x-[26px] gap-y-4 rounded-lg border border-divider bg-bg px-6 py-[22px] shadow-sm ${e.activo ? '' : 'opacity-75'}`}
              >
                <span className={`grid size-[42px] flex-none place-items-center rounded-full border ${tono.fondo}`} aria-hidden>
                  <Icon name="meeting_room" size={21} />
                </span>
                <div className="min-w-[150px]">
                  <h3 className="m-0 flex items-center gap-2 text-[18px] font-black tracking-[-0.02em]">
                    {e.nombre}
                    {!e.activo && <Badge tono="neutro">Inactivo</Badge>}
                  </h3>
                  <p className="m-0 text-[12.5px] font-semibold text-neutral-700">{e.nota ?? 'Sin descripción'}</p>
                </div>
                <Dato etiqueta="Funcionamiento" valor={horarios[i]?.isPending ? '…' : resumenHorario(horario)} />
                <Dato etiqueta="Sesión por defecto" valor={e.duracionDefectoMin ? `${e.duracionDefectoMin} min` : '—'} />
                <div className="min-w-[160px] flex-[1_1_180px]">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2.5">
                    <span className="text-[10.5px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Apartado esta semana</span>
                    <span className="text-[13px] font-black tabular-nums">{abiertoMin ? `${pct}%` : '—'}</span>
                  </div>
                  <span
                    className="block h-[7px] overflow-hidden rounded-full bg-neutral-300"
                    role="meter"
                    aria-label={`Horas apartadas de ${e.nombre}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <span className={`block h-full rounded-full ${tono.barra}`} style={{ width: `${pct}%` }} />
                  </span>
                </div>
                {puedeEditar && (
                  <Button variant="secondary" icon="edit" onClick={() => setEditando(e)} className="!py-2.5">
                    Editar
                  </Button>
                )}
              </article>
            );
          })
        }
      </EstadoConsulta>
      <p className="m-0 mt-1 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
        <Icon name="lock_clock" size={17} />
        Un espacio no admite dos reservas en el mismo bloque horario.
      </p>
      {puedeEditar && (
        <EditarEspacio
          abierto={nuevo || !!editando}
          espacio={editando}
          horario={editando ? (horarios[orden.indexOf(editando.id)]?.data ?? []) : []}
          onCerrar={() => {
            setEditando(null);
            onNuevoCerrado();
          }}
        />
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-[120px]">
      <div className="mb-1 text-[10.5px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{etiqueta}</div>
      <div className="text-[14px] font-extrabold tabular-nums">{valor}</div>
    </div>
  );
}

interface DiaBase {
  abre: boolean;
  inicio: string;
  fin: string;
}

const diasDesde = (horario: HorarioEspacio[]): DiaBase[] =>
  DIAS_SEMANA.map((_, i) => {
    const h = horario.find((x) => x.diaSemana === i + 1 && !x.vigenteDesde && !x.vigenteHasta);
    return h ? { abre: true, inicio: hhmm(h.inicioMin), fin: hhmm(h.finMin) } : { abre: false, inicio: '09:00', fin: '20:00' };
  });

/**
 * Crear o editar un box y su horario. El horario base rige siempre; los
 * horarios por periodo (semana, mes, trimestre) se agregan aparte y se
 * conservan al guardar. PUT reemplaza el horario completo: la BD rechaza (409)
 * si deja fuera un bloque ya apartado.
 */
function EditarEspacio({
  abierto,
  espacio,
  horario,
  onCerrar,
}: {
  abierto: boolean;
  espacio: EspacioVista | null;
  horario: HorarioEspacio[];
  onCerrar: () => void;
}) {
  const cliente = useQueryClient();
  const [clave, setClave] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [nota, setNota] = useState('');
  const [duracion, setDuracion] = useState(50);
  const [activo, setActivo] = useState(true);
  const [dias, setDias] = useState<DiaBase[]>(diasDesde([]));
  const [periodos, setPeriodos] = useState<BloqueEspacio[]>([]);
  const [nuevoPeriodo, setNuevoPeriodo] = useState({ dia: 1, inicio: '09:00', fin: '14:00', desde: '', hasta: '' });
  const [error, setError] = useState<string>();

  // Carga el formulario al abrir (o al cambiar de box).
  const actual = abierto ? (espacio?.id ?? 'nuevo') : null;
  if (actual !== clave) {
    setClave(actual);
    setNombre(espacio?.nombre ?? '');
    setNota(espacio?.nota ?? '');
    setDuracion(espacio?.duracionDefectoMin ?? 50);
    setActivo(espacio?.activo ?? true);
    setDias(diasDesde(horario));
    setPeriodos(
      horario
        .filter((h) => h.vigenteDesde || h.vigenteHasta)
        .map((h) => ({
          diaSemana: h.diaSemana,
          inicioMin: h.inicioMin,
          finMin: h.finMin,
          vigenteDesde: h.vigenteDesde ?? undefined,
          vigenteHasta: h.vigenteHasta ?? undefined,
        })),
    );
    setError(undefined);
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const cuerpo = { nombre: nombre.trim(), nota: nota.trim() || undefined, duracionDefectoMin: duracion };
      const id = espacio
        ? (await datos(api.PATCH('/api/espacios/{id}', { params: { path: { id: espacio.id } }, body: { ...cuerpo, activo } }))).id
        : (await datos(api.POST('/api/espacios', { body: cuerpo }))).id;
      const bloques: BloqueEspacio[] = [
        ...dias.flatMap((d, i) => (d.abre ? [{ diaSemana: i + 1, inicioMin: minutos(d.inicio), finMin: minutos(d.fin) }] : [])),
        ...periodos.map((p) => ({ ...p, vigenteDesde: p.vigenteDesde?.slice(0, 10), vigenteHasta: p.vigenteHasta?.slice(0, 10) })),
      ];
      await datos(api.PUT('/api/espacios/{id}/horario', { params: { path: { id } }, body: { bloques } }));
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'espacios'] });
      onCerrar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el espacio.'),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return setError('Escribe el nombre del espacio.');
    if (dias.some((d) => d.abre && minutos(d.fin) <= minutos(d.inicio))) return setError('En cada día, la hora de cierre debe ser posterior a la de apertura.');
    setError(undefined);
    guardar.mutate();
  };
  const agregarPeriodo = () => {
    const p = nuevoPeriodo;
    if (!p.desde || !p.hasta || p.hasta < p.desde) return setError('El periodo necesita fecha de inicio y de término (en ese orden).');
    if (minutos(p.fin) <= minutos(p.inicio)) return setError('La hora de cierre del periodo debe ser posterior a la de apertura.');
    setError(undefined);
    setPeriodos((l) => [...l, { diaSemana: p.dia, inicioMin: minutos(p.inicio), finMin: minutos(p.fin), vigenteDesde: p.desde, vigenteHasta: p.hasta }]);
  };
  const cambiarDia = (i: number, cambio: Partial<DiaBase>) => setDias((l) => l.map((d, j) => (j === i ? { ...d, ...cambio } : d)));

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      ancho="lg"
      titulo={espacio ? `Editar ${espacio.nombre}` : 'Agregar espacio'}
      descripcion="Sobre este horario los profesionales apartan sus horas de box."
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Nombre del espacio" required>
            {(p) => <Input {...p} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />}
          </Field>
          <Field label="Sesión por defecto">
            {(p) => (
              <Select {...p} value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
                {DURACIONES.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Descripción (opcional)" hint="Por ejemplo: sala amplia para trabajo familiar.">
          {(p) => <Input {...p} value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />}
        </Field>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-[12.5px] font-extrabold">Horario base (rige siempre)</legend>
          {dias.map((d, i) => (
            <div key={DIAS_SEMANA[i]} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-neutral-100 px-3.5 py-2">
              <label className="flex w-[118px] cursor-pointer items-center gap-2 text-[13.5px] font-extrabold">
                <input type="checkbox" checked={d.abre} onChange={(e) => cambiarDia(i, { abre: e.target.checked })} className="size-4 accent-accent-700" />
                {DIAS_SEMANA[i]}
              </label>
              {d.abre ? (
                <span className="flex items-center gap-2">
                  <Input
                    type="time"
                    step={900}
                    aria-label={`${DIAS_SEMANA[i]}: abre`}
                    value={d.inicio}
                    onChange={(e) => cambiarDia(i, { inicio: e.target.value })}
                    className="!w-[150px] !py-2"
                  />
                  <span className="text-[13px] font-bold text-neutral-700">a</span>
                  <Input
                    type="time"
                    step={900}
                    aria-label={`${DIAS_SEMANA[i]}: cierra`}
                    value={d.fin}
                    onChange={(e) => cambiarDia(i, { fin: e.target.value })}
                    className="!w-[150px] !py-2"
                  />
                </span>
              ) : (
                <span className="text-[13px] font-semibold text-neutral-700">Cerrado</span>
              )}
            </div>
          ))}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-[12.5px] font-extrabold">Horarios por periodo (opcional)</legend>
          <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
            Para una semana, mes o trimestre con otro horario (por ejemplo, verano). Se suman al horario base.
          </p>
          {periodos.map((p, i) => (
            <div
              key={`${p.diaSemana}-${p.vigenteDesde}-${i}`}
              className="flex items-center gap-3 rounded-[14px] border border-divider px-3.5 py-2 text-[13.5px] font-bold"
            >
              <span className="flex-1">
                {DIAS_SEMANA[p.diaSemana - 1]} {hhmm(p.inicioMin)} – {hhmm(p.finMin)} · del {formatoFecha(p.vigenteDesde!.slice(0, 10))} al{' '}
                {formatoFecha(p.vigenteHasta!.slice(0, 10))}
              </span>
              <button
                type="button"
                aria-label="Quitar periodo"
                onClick={() => setPeriodos((l) => l.filter((_, j) => j !== i))}
                className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-neutral-400 p-3">
            <Field label="Día">
              {(p) => (
                <Select {...p} value={nuevoPeriodo.dia} onChange={(e) => setNuevoPeriodo((n) => ({ ...n, dia: Number(e.target.value) }))} className="!py-2">
                  {DIAS_SEMANA.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Abre">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  step={900}
                  value={nuevoPeriodo.inicio}
                  onChange={(e) => setNuevoPeriodo((n) => ({ ...n, inicio: e.target.value }))}
                  className="!w-[150px] !py-2"
                />
              )}
            </Field>
            <Field label="Cierra">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  step={900}
                  value={nuevoPeriodo.fin}
                  onChange={(e) => setNuevoPeriodo((n) => ({ ...n, fin: e.target.value }))}
                  className="!w-[150px] !py-2"
                />
              )}
            </Field>
            <Field label="Desde">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={nuevoPeriodo.desde}
                  onChange={(e) => setNuevoPeriodo((n) => ({ ...n, desde: e.target.value }))}
                  className="!py-2"
                />
              )}
            </Field>
            <Field label="Hasta">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={nuevoPeriodo.hasta}
                  onChange={(e) => setNuevoPeriodo((n) => ({ ...n, hasta: e.target.value }))}
                  className="!py-2"
                />
              )}
            </Field>
            <Button variant="secondary" icon="add" onClick={agregarPeriodo} className="!py-2.5">
              Agregar
            </Button>
          </div>
        </fieldset>

        {espacio && (
          <Interruptor
            tono="team"
            etiqueta="Espacio activo"
            descripcion="Un espacio inactivo no admite horas apartadas nuevas."
            activo={activo}
            onChange={setActivo}
          />
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
          <Button type="submit" variant="team" loading={guardar.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
