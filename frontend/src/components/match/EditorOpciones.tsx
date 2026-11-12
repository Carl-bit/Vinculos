'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';

type Pregunta = components['schemas']['MatchPreguntaVista'];
type Opcion = components['schemas']['MatchOpcionVista'];
export type TipoPregunta = Pregunta['tipo'];
type Criterio = NonNullable<Opcion['criterio']>;

/**
 * Editor visual de las opciones de una pregunta del match (punto 28, ronda
 * 2026-11-12): cada tipo tiene su propio editor, nunca una caja de texto.
 * - Alternativas (una o varias): agregar, ordenar, editar, eliminar y darles
 *   prioridad (peso) y si filtran (estricto) segun lo que buscan del perfil.
 * - Escala: plantillas (1 a 5, 1 a 10, intensidad, frecuencia, acuerdo) y
 *   niveles editables, con aviso opcional al elegir un nivel.
 * - Dias: solo los dias en que atiende el centro.
 * - Franjas: nombre y horas, dentro del horario del centro.
 * Trabaja sobre un borrador; `guardarOpciones` aplica la diferencia.
 */
export type Borrador = {
  id?: string;
  valor: string;
  etiqueta: string;
  nota: string;
  criterio: Criterio | '';
  objetivo: string;
  peso: number;
  estricto: boolean;
  activa: boolean;
  mensaje: string;
};

export type LimitesCentro = { dias: number[]; inicio: number; fin: number };

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const CRITERIO: Record<Criterio, string> = {
  TIPO_ATENCION: 'Tipo de atención',
  ENFOQUE: 'Enfoque o motivo',
  ESPECIALIDAD: 'Especialidad',
  MODALIDAD: 'Modalidad',
  PREVISION: 'Previsión',
  PRESUPUESTO: 'Presupuesto (tope en CLP)',
};
/** Objetivos con valores fijos en el perfil: se eligen, no se escriben. */
const OBJETIVOS_FIJOS: Partial<Record<Criterio, [string, string][]>> = {
  MODALIDAD: [
    ['ONLINE', 'Online'],
    ['PRESENCIAL', 'Presencial'],
  ],
  PREVISION: [
    ['FONASA', 'FONASA'],
    ['ISAPRE', 'Isapre'],
  ],
};
const PRIORIDADES: [number, string][] = [
  [0, 'Sin peso'],
  [1, 'Baja'],
  [3, 'Media'],
  [5, 'Alta'],
];

export const vacio = (etiqueta = '', extra: Partial<Borrador> = {}): Borrador => ({
  valor: '',
  etiqueta,
  nota: '',
  criterio: '',
  objetivo: '',
  peso: 0,
  estricto: false,
  activa: true,
  mensaje: '',
  ...extra,
});

export const aBorrador = (o: Opcion): Borrador => ({
  id: o.id,
  valor: o.valor,
  etiqueta: o.etiqueta,
  nota: o.nota ?? '',
  criterio: o.criterio ?? '',
  objetivo: o.objetivo ?? '',
  peso: o.peso,
  estricto: o.estricto,
  activa: o.activa,
  mensaje: o.mensaje ?? '',
});

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutos = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
export const franja = (etiqueta: string, a: number, b: number): Borrador => vacio(etiqueta, { valor: `${a}-${b}`, nota: `${hhmm(a)} – ${hhmm(b)}` });
const rango = (b: Borrador) => b.valor.split('-').map(Number) as [number, number];

/** Franjas por defecto, recortadas al horario del centro (las que quedan vacias se omiten). */
export function franjasPorDefecto(l: LimitesCentro): Borrador[] {
  return (
    [
      ['Mañana', 480, 720],
      ['Mediodía', 720, 900],
      ['Tarde', 900, 1140],
      ['Noche', 1140, 1260],
    ] as const
  )
    .map(([n, a, b]) => [n, Math.max(a, l.inicio), Math.min(b, l.fin)] as const)
    .filter(([, a, b]) => a < b)
    .map(([n, a, b]) => franja(n, a, b));
}
export const diasDelCentro = (l: LimitesCentro) => l.dias.map((d) => vacio(DIAS[d - 1], { valor: String(d) }));

const ESCALAS: Record<string, { titulo: string; niveles: string[]; extremos?: [string, string] }> = {
  intensidad: { titulo: 'Intensidad (Nada → Mucho)', niveles: ['Nada', 'Poco', 'Algo', 'Bastante', 'Mucho'] },
  frecuencia: { titulo: 'Frecuencia (Nunca → Siempre)', niveles: ['Nunca', 'Casi nunca', 'A veces', 'Casi siempre', 'Siempre'] },
  acuerdo: {
    titulo: 'Acuerdo (Muy en desacuerdo → Muy de acuerdo)',
    niveles: ['Muy en desacuerdo', 'En desacuerdo', 'Neutral', 'De acuerdo', 'Muy de acuerdo'],
  },
  n5: { titulo: 'Números del 1 al 5', niveles: ['1', '2', '3', '4', '5'], extremos: ['Nada', 'Muchísimo'] },
  n10: { titulo: 'Números del 1 al 10', niveles: Array.from({ length: 10 }, (_, i) => String(i + 1)), extremos: ['Nada', 'Muchísimo'] },
};
export const escala = (id: keyof typeof ESCALAS): Borrador[] => {
  const e = ESCALAS[id];
  return e.niveles.map((n, i) =>
    vacio(n, { valor: String(i + 1), nota: e.extremos ? (i === 0 ? e.extremos[0] : i === e.niveles.length - 1 ? e.extremos[1] : '') : '' }),
  );
};

const claveDe = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 36);

/** Valor interno de cada opcion: dias y franjas lo llevan fijo; el resto sale del texto, sin repetir. */
function conValores(tipo: TipoPregunta, lista: Borrador[], usados: Set<string>): Borrador[] {
  const ocupados = new Set([...usados, ...lista.filter((b) => b.id).map((b) => b.valor)]);
  return lista.map((b, i) => {
    if (b.id || tipo === 'DIAS' || tipo === 'FRANJAS') return b;
    const base = (tipo === 'ESCALA' ? String(i + 1) : claveDe(b.etiqueta)) || `opcion_${i + 1}`;
    let valor = base;
    for (let n = 2; ocupados.has(valor); n++) valor = `${base}_${n}`;
    ocupados.add(valor);
    return { ...b, valor };
  });
}

/** Mensaje de error del borrador, o undefined si se puede guardar. */
export function validar(tipo: TipoPregunta, lista: Borrador[], l: LimitesCentro): string | undefined {
  if (tipo === 'TEXTO') return undefined;
  if (tipo === 'DIAS') return lista.length ? undefined : 'Marca al menos un día.';
  if (lista.some((b) => b.etiqueta.trim().length === 0)) return 'Todas las opciones necesitan un texto.';
  const textos = lista.map((b) => b.etiqueta.trim().toLowerCase());
  if (new Set(textos).size !== textos.length) return 'Hay opciones con el mismo texto.';
  if (tipo === 'FRANJAS') {
    if (!lista.length) return 'Agrega al menos una franja.';
    const r = lista.map(rango).sort((a, b) => a[0] - b[0]);
    if (r.some(([a, b]) => !(a < b))) return 'Cada franja debe terminar después de empezar.';
    if (r.some(([a, b]) => a < l.inicio || b > l.fin)) return `Las franjas deben quedar dentro del horario del centro (${hhmm(l.inicio)} a ${hhmm(l.fin)}).`;
    if (r.some(([a], i) => i > 0 && a < r[i - 1][1])) return 'Las franjas no pueden superponerse.';
    return undefined;
  }
  if (lista.length < 2) return 'Agrega al menos dos opciones.';
  if (lista.length > 20) return 'Máximo 20 opciones.';
  if (lista.some((b) => b.criterio === 'PRESUPUESTO' && !/^\d+$/.test(b.objetivo.trim()))) return 'El tope de presupuesto va en pesos, solo números.';
  if (lista.some((b) => b.criterio && !b.objetivo.trim())) return 'Indica qué busca cada opción con criterio.';
  return undefined;
}

/** Cuerpo para crear las opciones junto con la pregunta. */
export const opcionesNuevas = (tipo: TipoPregunta, lista: Borrador[]): components['schemas']['OpcionMatchDto'][] =>
  conValores(tipo, lista, new Set()).map((b, i) => ({
    valor: b.valor,
    etiqueta: b.etiqueta.trim(),
    orden: i + 1,
    nota: b.nota.trim() || undefined,
    criterio: b.criterio || undefined,
    objetivo: b.criterio ? b.objetivo.trim() : undefined,
    peso: b.criterio ? b.peso : 0,
    estricto: b.criterio ? b.estricto : false,
    mensaje: b.mensaje.trim() || undefined,
  }));

/**
 * Aplica el borrador sobre las opciones guardadas: primero crea y edita, al
 * final elimina (la BD no deja una pregunta de seleccion sin opciones). Una
 * franja con otras horas cambia su valor interno: se reemplaza.
 */
export async function guardarOpciones(pregunta: Pregunta, lista: Borrador[]) {
  const originales = new Map(pregunta.opciones.map((o) => [o.id, o]));
  const cambiadas = lista.map((b) => (b.id && originales.get(b.id)!.valor !== b.valor ? { ...b, id: undefined } : b));
  // Un dia o franja que se quito y se volvio a poner reusa su fila (el valor es unico por pregunta).
  const tomadas = new Set(cambiadas.flatMap((b) => (b.id ? [b.id] : [])));
  const vigentes = cambiadas.map((b) => {
    if (b.id || !b.valor) return b;
    const previa = pregunta.opciones.find((o) => o.valor === b.valor && !tomadas.has(o.id));
    if (!previa) return b;
    tomadas.add(previa.id);
    return { ...b, id: previa.id };
  });
  const conservadas = new Set(vigentes.flatMap((b) => (b.id ? [b.id] : [])));
  const nuevos = opcionesNuevas(pregunta.tipo, vigentes);
  const usados = new Set(pregunta.opciones.map((o) => o.valor));
  const finales = conValores(pregunta.tipo, vigentes, usados);
  for (const [i, b] of finales.entries()) {
    if (!b.id) {
      await datos(api.POST('/api/match/preguntas/{id}/opciones', { params: { path: { id: pregunta.id } }, body: { ...nuevos[i], valor: b.valor } }));
      continue;
    }
    const o = originales.get(b.id)!;
    const cambio: Record<string, unknown> = {};
    const fijar = (k: string, antes: unknown, ahora: unknown) => antes !== ahora && (cambio[k] = ahora);
    fijar('etiqueta', o.etiqueta, b.etiqueta.trim());
    fijar('nota', o.nota, b.nota.trim() || null);
    fijar('orden', o.orden, i + 1);
    fijar('activa', o.activa, b.activa);
    fijar('criterio', o.criterio, b.criterio || null);
    fijar('objetivo', o.objetivo, b.criterio ? b.objetivo.trim() : null);
    fijar('peso', o.peso, b.criterio ? b.peso : 0);
    fijar('estricto', o.estricto, b.criterio ? b.estricto : false);
    fijar('mensaje', o.mensaje, b.mensaje.trim() || null);
    if (Object.keys(cambio).length) {
      // null limpia el campo (los DTO lo aceptan como "sin valor").
      await datos(api.PATCH('/api/match/opciones/{id}', { params: { path: { id: b.id } }, body: cambio as components['schemas']['EditarOpcionMatchDto'] }));
    }
  }
  for (const id of originales.keys()) {
    if (!conservadas.has(id)) await datos(api.DELETE('/api/match/opciones/{id}', { params: { path: { id } } }));
  }
}

export function EditorOpciones({
  tipo,
  opciones,
  limites,
  onChange,
}: {
  tipo: TipoPregunta;
  opciones: Borrador[];
  limites: LimitesCentro;
  onChange: (b: Borrador[]) => void;
}) {
  if (tipo === 'TEXTO') {
    return <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Respuesta libre: no tiene opciones ni puntúa; la lee el profesional.</p>;
  }
  if (tipo === 'DIAS') return <EditorDias opciones={opciones} limites={limites} onChange={onChange} />;
  if (tipo === 'FRANJAS') return <EditorFranjas opciones={opciones} limites={limites} onChange={onChange} />;
  if (tipo === 'ESCALA') return <EditorEscala opciones={opciones} onChange={onChange} />;
  return <EditorAlternativas opciones={opciones} onChange={onChange} />;
}

const Titulo = ({ children }: { children: string }) => <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{children}</p>;

/** Flechas para subir y bajar una fila y boton de eliminar. */
function Controles({
  i,
  total,
  nombre,
  onMover,
  onEliminar,
}: {
  i: number;
  total: number;
  nombre: string;
  onMover: (d: -1 | 1) => void;
  onEliminar: () => void;
}) {
  const clase = 'grid size-8 cursor-pointer place-items-center rounded-full hover:bg-accent-200 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex flex-none items-center">
      <button type="button" aria-label={`Subir «${nombre}»`} disabled={i === 0} onClick={() => onMover(-1)} className={clase}>
        <Icon name="arrow_upward" size={17} />
      </button>
      <button type="button" aria-label={`Bajar «${nombre}»`} disabled={i === total - 1} onClick={() => onMover(1)} className={clase}>
        <Icon name="arrow_downward" size={17} />
      </button>
      <button type="button" aria-label={`Eliminar «${nombre}»`} onClick={onEliminar} className={`${clase} text-accent-700`}>
        <Icon name="delete" size={17} />
      </button>
    </div>
  );
}

const mover = <T,>(l: T[], i: number, d: number) => {
  const r = [...l];
  [r[i], r[i + d]] = [r[i + d], r[i]];
  return r;
};

function EditorAlternativas({ opciones, onChange }: { opciones: Borrador[]; onChange: (b: Borrador[]) => void }) {
  const cambiar = (i: number, c: Partial<Borrador>) => onChange(opciones.map((b, k) => (k === i ? { ...b, ...c } : b)));
  return (
    <div className="flex flex-col gap-2">
      <Titulo>Alternativas</Titulo>
      {opciones.length === 0 && <p className="m-0 text-[13px] font-semibold text-neutral-700">Todavía no hay alternativas.</p>}
      {opciones.map((b, i) => (
        <FilaAlternativa
          key={b.id ?? `n${i}`}
          b={b}
          i={i}
          total={opciones.length}
          onCambio={(c) => cambiar(i, c)}
          onMover={(d) => onChange(mover(opciones, i, d))}
          onEliminar={() => onChange(opciones.filter((_, k) => k !== i))}
        />
      ))}
      <Button variant="secondary" icon="add" disabled={opciones.length >= 20} onClick={() => onChange([...opciones, vacio()])} className="self-start !py-2">
        Agregar alternativa
      </Button>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">
        El orden es el que ve el paciente. La prioridad suma puntos al profesional que cumple lo que busca la opción; «filtra» deja fuera a quien no lo cumple.
      </p>
    </div>
  );
}

function FilaAlternativa({
  b,
  i,
  total,
  onCambio,
  onMover,
  onEliminar,
}: {
  b: Borrador;
  i: number;
  total: number;
  onCambio: (c: Partial<Borrador>) => void;
  onMover: (d: -1 | 1) => void;
  onEliminar: () => void;
}) {
  const [mas, setMas] = useState(!!(b.nota || b.mensaje));
  const nombre = b.etiqueta || `opción ${i + 1}`;
  const fijos = b.criterio ? OBJETIVOS_FIJOS[b.criterio] : undefined;
  return (
    <div className={`flex flex-col gap-2.5 rounded-[14px] border border-divider px-3 py-2.5 ${b.activa ? 'bg-bg' : 'bg-neutral-100'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 flex-none text-[12px] font-extrabold text-neutral-700 tabular-nums">{i + 1}.</span>
        <Input
          aria-label={`Texto de la alternativa ${i + 1}`}
          placeholder="Texto que ve el paciente"
          value={b.etiqueta}
          maxLength={120}
          onChange={(e) => onCambio({ etiqueta: e.target.value })}
          className={`!min-w-[180px] !flex-1 !py-1.5 !text-[13.5px] !font-bold ${b.activa ? '' : 'text-neutral-700 line-through'}`}
        />
        {b.id && (
          <button
            type="button"
            onClick={() => onCambio({ activa: !b.activa })}
            className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
          >
            {b.activa ? 'Apagar' : 'Activar'}
          </button>
        )}
        <Controles i={i} total={total} nombre={nombre} onMover={onMover} onEliminar={onEliminar} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          aria-label={`Qué busca «${nombre}» en el perfil`}
          value={b.criterio}
          onChange={(e) => {
            const criterio = e.target.value as Criterio | '';
            const f = criterio ? OBJETIVOS_FIJOS[criterio] : undefined;
            onCambio({ criterio, objetivo: f ? f[0][0] : '', peso: criterio ? b.peso || 3 : 0, estricto: criterio ? b.estricto : false });
          }}
          className="!py-1.5 !text-[13px]"
        >
          <option value="">No busca nada en el perfil</option>
          {(Object.keys(CRITERIO) as Criterio[]).map((c) => (
            <option key={c} value={c}>
              Busca: {CRITERIO[c]}
            </option>
          ))}
        </Select>
        {b.criterio &&
          (fijos ? (
            <Select
              aria-label={`Valor que busca «${nombre}»`}
              value={b.objetivo}
              onChange={(e) => onCambio({ objetivo: e.target.value })}
              className="!py-1.5 !text-[13px]"
            >
              {fijos.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              aria-label={`Valor que busca «${nombre}»`}
              inputMode={b.criterio === 'PRESUPUESTO' ? 'numeric' : undefined}
              placeholder={b.criterio === 'PRESUPUESTO' ? 'Tope en CLP, p. ej. 35000' : 'Tal como figura en el perfil, p. ej. Ansiedad'}
              value={b.objetivo}
              maxLength={120}
              onChange={(e) => onCambio({ objetivo: e.target.value })}
              className="!py-1.5 !text-[13px]"
            />
          ))}
      </div>
      {b.criterio && b.criterio !== 'PRESUPUESTO' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-extrabold text-neutral-800">Prioridad</span>
          <div role="group" aria-label={`Prioridad de «${nombre}»`} className="flex flex-wrap gap-1 rounded-full bg-neutral-200 p-1">
            {PRIORIDADES.map(([peso, texto]) => (
              <button
                key={peso}
                type="button"
                aria-pressed={b.peso === peso}
                onClick={() => onCambio({ peso })}
                className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-bold ${b.peso === peso ? 'bg-accent-700 text-neutral-100' : 'hover:bg-neutral-300'}`}
              >
                {texto}
              </button>
            ))}
          </div>
          {!PRIORIDADES.some(([p]) => p === b.peso) && <span className="text-[12px] font-semibold text-neutral-700">Actual: {b.peso} puntos</span>}
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold">
            <input type="checkbox" checked={b.estricto} onChange={(e) => onCambio({ estricto: e.target.checked })} className="size-4 accent-accent-700" />
            Filtra: deja fuera a quien no cumple
          </label>
        </div>
      )}
      <button
        type="button"
        aria-expanded={mas}
        onClick={() => setMas(!mas)}
        className="cursor-pointer self-start text-[12px] font-extrabold text-accent-700 hover:underline"
      >
        {mas ? 'Ocultar descripción y aviso' : 'Agregar descripción o aviso'}
      </button>
      {mas && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label={`Descripción de «${nombre}»`}
            placeholder="Descripción breve (opcional)"
            value={b.nota}
            maxLength={200}
            onChange={(e) => onCambio({ nota: e.target.value })}
            className="!py-1.5 !text-[13px]"
          />
          <Input
            aria-label={`Aviso al elegir «${nombre}»`}
            placeholder="Aviso al elegirla, p. ej. una línea de ayuda (opcional)"
            value={b.mensaje}
            maxLength={500}
            onChange={(e) => onCambio({ mensaje: e.target.value })}
            className="!py-1.5 !text-[13px]"
          />
        </div>
      )}
    </div>
  );
}

function EditorEscala({ opciones, onChange }: { opciones: Borrador[]; onChange: (b: Borrador[]) => void }) {
  const cambiar = (i: number, c: Partial<Borrador>) => onChange(opciones.map((b, k) => (k === i ? { ...b, ...c } : b)));
  return (
    <div className="flex flex-col gap-2">
      <Titulo>Tipo de escala</Titulo>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(ESCALAS) as (keyof typeof ESCALAS)[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(escala(k))}
            className="cursor-pointer rounded-full border-[1.5px] border-neutral-400 px-3 py-1.5 text-[12.5px] font-bold hover:border-accent-500 hover:bg-accent-200"
          >
            {ESCALAS[k].titulo}
          </button>
        ))}
      </div>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">Elegir una plantilla reemplaza los niveles. Después puedes cambiar sus textos.</p>
      <Titulo>Niveles (del menor al mayor)</Titulo>
      {opciones.map((b, i) => (
        <div key={b.id ?? `n${i}`} className="flex flex-wrap items-center gap-2 rounded-[14px] border border-divider bg-bg px-3 py-2">
          <span className="w-5 flex-none text-[12px] font-extrabold text-neutral-700 tabular-nums">{i + 1}.</span>
          <Input
            aria-label={`Texto del nivel ${i + 1}`}
            value={b.etiqueta}
            maxLength={120}
            onChange={(e) => cambiar(i, { etiqueta: e.target.value })}
            className="!min-w-[140px] !flex-1 !py-1.5 !text-[13.5px] !font-bold"
          />
          <Input
            aria-label={`Descripción del nivel ${i + 1}`}
            placeholder="Descripción (opcional)"
            value={b.nota}
            maxLength={200}
            onChange={(e) => cambiar(i, { nota: e.target.value })}
            className="!min-w-[160px] !flex-1 !py-1.5 !text-[13px]"
          />
          <Input
            aria-label={`Aviso al elegir el nivel ${i + 1}`}
            placeholder="Aviso al elegirlo (opcional)"
            value={b.mensaje}
            maxLength={500}
            onChange={(e) => cambiar(i, { mensaje: e.target.value })}
            className="!min-w-[160px] !flex-1 !py-1.5 !text-[13px]"
          />
          <Controles
            i={i}
            total={opciones.length}
            nombre={b.etiqueta || `nivel ${i + 1}`}
            onMover={(d) => onChange(mover(opciones, i, d))}
            onEliminar={() => onChange(opciones.filter((_, k) => k !== i))}
          />
        </div>
      ))}
      <Button variant="secondary" icon="add" disabled={opciones.length >= 20} onClick={() => onChange([...opciones, vacio()])} className="self-start !py-2">
        Agregar nivel
      </Button>
    </div>
  );
}

function EditorDias({ opciones, limites, onChange }: { opciones: Borrador[]; limites: LimitesCentro; onChange: (b: Borrador[]) => void }) {
  const marcados = new Map(opciones.map((b) => [b.valor, b]));
  const alternar = (d: number) => {
    const v = String(d);
    const siguiente = marcados.has(v) ? opciones.filter((b) => b.valor !== v) : [...opciones, vacio(DIAS[d - 1], { valor: v })];
    onChange(siguiente.sort((a, b) => Number(a.valor) - Number(b.valor)));
  };
  return (
    <div className="flex flex-col gap-2">
      <Titulo>Días que puede elegir el paciente</Titulo>
      <div className="flex flex-wrap gap-1.5">
        {DIAS.map((nombre, k) => {
          const d = k + 1;
          const atiende = limites.dias.includes(d);
          const activo = marcados.has(String(d));
          return (
            <button
              key={d}
              type="button"
              aria-pressed={activo}
              disabled={!atiende && !activo}
              title={atiende ? undefined : 'El centro no atiende este día'}
              onClick={() => alternar(d)}
              className={`min-h-10 cursor-pointer rounded-full border-[1.5px] px-3.5 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
                activo ? 'border-accent-700 bg-accent-700 text-neutral-100' : 'border-neutral-400 hover:bg-accent-200'
              }`}
            >
              {nombre}
            </button>
          );
        })}
      </div>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">
        Solo se ofrecen los días en que atiende el centro (Configuración → Horario).{' '}
        <button type="button" onClick={() => onChange(diasDelCentro(limites))} className="cursor-pointer font-extrabold text-accent-700 hover:underline">
          Usar todos los días del centro
        </button>
      </p>
    </div>
  );
}

function EditorFranjas({ opciones, limites, onChange }: { opciones: Borrador[]; limites: LimitesCentro; onChange: (b: Borrador[]) => void }) {
  const cambiar = (i: number, b: Borrador) => onChange(opciones.map((x, k) => (k === i ? b : x)));
  const nuevaFranja = () => {
    const desde = Math.min(Math.max(...opciones.map((b) => rango(b)[1]), limites.inicio), limites.fin - 60);
    onChange([...opciones, franja('', desde, Math.min(desde + 120, limites.fin))]);
  };
  return (
    <div className="flex flex-col gap-2">
      <Titulo>Franjas horarias</Titulo>
      <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
        El centro atiende de {hhmm(limites.inicio)} a {hhmm(limites.fin)}: las franjas deben quedar dentro de ese horario.
      </p>
      {opciones.map((b, i) => {
        const [a, z] = rango(b);
        const nombre = b.etiqueta || `franja ${i + 1}`;
        const horas = (na: number, nz: number) => ({ ...b, valor: `${na}-${nz}`, nota: `${hhmm(na)} – ${hhmm(nz)}` });
        return (
          <div key={b.id ?? `n${i}`} className="flex flex-wrap items-center gap-2 rounded-[14px] border border-divider bg-bg px-3 py-2">
            <Input
              aria-label={`Nombre de la franja ${i + 1}`}
              placeholder="Nombre, p. ej. Mañana"
              value={b.etiqueta}
              maxLength={120}
              onChange={(e) => cambiar(i, { ...b, etiqueta: e.target.value })}
              className="!min-w-[150px] !flex-1 !py-1.5 !text-[13.5px] !font-bold"
            />
            <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
              Desde
              <Input
                type="time"
                step={900}
                min={hhmm(limites.inicio)}
                max={hhmm(limites.fin)}
                aria-label={`Inicio de «${nombre}»`}
                value={hhmm(a)}
                onChange={(e) => e.target.value && cambiar(i, horas(minutos(e.target.value), z))}
                className="!w-[118px] !py-1.5 !text-[13px]"
              />
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
              hasta
              <Input
                type="time"
                step={900}
                min={hhmm(limites.inicio)}
                max={hhmm(limites.fin)}
                aria-label={`Término de «${nombre}»`}
                value={hhmm(z)}
                onChange={(e) => e.target.value && cambiar(i, horas(a, minutos(e.target.value)))}
                className="!w-[118px] !py-1.5 !text-[13px]"
              />
            </span>
            <Controles
              i={i}
              total={opciones.length}
              nombre={nombre}
              onMover={(d) => onChange(mover(opciones, i, d))}
              onEliminar={() => onChange(opciones.filter((_, k) => k !== i))}
            />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="add" disabled={opciones.length >= 12} onClick={nuevaFranja} className="!py-2">
          Agregar franja
        </Button>
        <Button variant="ghost" icon="schedule" onClick={() => onChange(franjasPorDefecto(limites))} className="!py-2">
          Volver a las franjas por defecto
        </Button>
      </div>
    </div>
  );
}
