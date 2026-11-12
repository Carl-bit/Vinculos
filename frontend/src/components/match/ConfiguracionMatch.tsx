'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import {
  EditorOpciones,
  aBorrador,
  diasDelCentro,
  escala,
  franjasPorDefecto,
  guardarOpciones,
  opcionesNuevas,
  vacio,
  validar,
  type Borrador,
  type LimitesCentro,
} from '@/components/match/EditorOpciones';
import { Encabezado } from '@/components/shared/Encabezado';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, useHorarioCentro } from '@/lib/centro';
import { useModulos } from '@/lib/consultas';
import type { Icono } from '@/lib/iconos';

type Pregunta = components['schemas']['MatchPreguntaVista'];

const TIPO: Record<Pregunta['tipo'], string> = {
  UNICA: 'Una opción',
  MULTIPLE: 'Varias opciones',
  ESCALA: 'Escala',
  TEXTO: 'Texto libre',
  DIAS: 'Días',
  FRANJAS: 'Franjas horarias',
};
const clave = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

/**
 * Configuracion del match (diseño "Admin - Match Configuracion", solo ADMIN):
 * preguntas del cuestionario (las apagadas no se muestran ni filtran; nunca se
 * borran), opciones con su criterio y peso, filtro directo y metricas. Sin
 * Agenda activa, los resultados no muestran disponibilidad real.
 */
export function ConfiguracionMatch() {
  const preguntas = useQuery({ queryKey: ['match', 'preguntas'], queryFn: () => datos(api.GET('/api/match/preguntas')) });
  const activos = useModulos().data?.activos ?? [];
  const [nueva, setNueva] = useState(false);
  return (
    <>
      <Encabezado
        tono="team"
        sobretitulo="Match Terapéutico"
        titulo="Configuración del match"
        bajada="Qué se pregunta al paciente y cómo se ordenan los resultados en la página del centro."
        accion={
          <ButtonLink href="/match" variant="secondary" icon="open_in_new">
            Ver cuestionario público
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-6">
        {!activos.includes('AGENDA') && (
          <Aviso tono="advertencia">Sin Agenda y Espacios activo, los resultados no muestran disponibilidad en tiempo real.</Aviso>
        )}
        {/* Punto 29: metricas y filtro directo arriba de las preguntas. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Metricas />
          <FiltroDirecto />
        </div>
        <Panel
          titulo="Preguntas del cuestionario"
          bajada="Las preguntas apagadas no se le muestran al paciente ni se usan para filtrar. Arrastra el ícono de puntos para cambiar el orden en que aparecen."
          accion={preguntas.data ? <Badge>{`${preguntas.data.filter((p) => p.activa).length} de ${preguntas.data.length} activas`}</Badge> : undefined}
        >
          <div className="mt-4 flex flex-col gap-2.5">
            <EstadoConsulta consulta={preguntas} vacio={(l) => l.length === 0} textoVacio="Sin preguntas">
              {(l) => <ListaPreguntas preguntas={l} formularioAbierto={nueva} />}
            </EstadoConsulta>
            {nueva ? (
              <NuevaPregunta
                orden={Math.max(0, ...(preguntas.data ?? []).map((p) => p.orden)) + 1}
                tiposUsados={(preguntas.data ?? []).map((p) => p.tipo)}
                onCerrar={() => setNueva(false)}
              />
            ) : (
              <Button variant="secondary" icon="add" onClick={() => setNueva(true)} className="self-start !py-2.5">
                Agregar pregunta propia del centro
              </Button>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

/**
 * Orden del cuestionario: se arrastra por el asa (mouse o touch) o con las
 * flechas del teclado. Con una pregunta abierta nada se mueve, para no mezclar
 * un reordenamiento con una edicion a medio camino. Guarda solo las que cambian.
 */
function ListaPreguntas({ preguntas, formularioAbierto }: { preguntas: Pregunta[]; formularioAbierto: boolean }) {
  const cliente = useQueryClient();
  const filas = useRef(new Map<string, HTMLDivElement>());
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const [arrastre, setArrastre] = useState<{ id: string; orden: string[] } | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [error, setError] = useState<string>();
  const guardar = useMutation({
    mutationFn: (cambios: { id: string; orden: number }[]) =>
      Promise.all(cambios.map(({ id, orden }) => datos(api.PATCH('/api/match/preguntas/{id}', { params: { path: { id } }, body: { orden } })))),
    onSuccess: () => setError(undefined),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el nuevo orden.'),
    onSettled: () => void cliente.invalidateQueries({ queryKey: ['match', 'preguntas'] }),
  });
  const bloqueado = abiertas.size > 0 || formularioAbierto || guardar.isPending;
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const visibles = arrastre ? arrastre.orden.map((id) => porId.get(id)!) : preguntas;

  const fijar = (orden: string[]) => {
    const cambios = orden.map((id, i) => ({ id, orden: i + 1 })).filter((c) => porId.get(c.id)!.orden !== c.orden);
    if (cambios.length === 0) return;
    cliente.setQueryData(
      ['match', 'preguntas'],
      orden.map((id, i) => ({ ...porId.get(id)!, orden: i + 1 })),
    );
    guardar.mutate(cambios);
  };
  // Se sigue en window: reordenar mueve la fila en el DOM y el asa perderia la captura del puntero.
  const tomar = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (bloqueado) return;
    e.preventDefault();
    let orden = preguntas.map((p) => p.id);
    setArrastre({ id, orden });
    const mover = (ev: globalThis.PointerEvent) => {
      const resto = orden.filter((x) => x !== id);
      const antes = resto.findIndex((x) => {
        const r = filas.current.get(x)!.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      const destino = antes === -1 ? resto.length : antes;
      if (orden[destino] === id) return;
      orden = resto.toSpliced(destino, 0, id);
      setArrastre({ id, orden });
    };
    const terminar = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', terminar);
      window.removeEventListener('pointercancel', terminar);
      setArrastre(null);
      if (ev.type === 'pointerup') fijar(orden);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', terminar);
    window.addEventListener('pointercancel', terminar);
  };
  const teclado = (e: KeyboardEvent, p: Pregunta, i: number) => {
    const destino = i + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
    if (destino === i) return;
    e.preventDefault();
    if (bloqueado || destino < 0 || destino >= preguntas.length) return;
    const ids = preguntas.map((x) => x.id);
    ids.splice(i, 1);
    ids.splice(destino, 0, p.id);
    fijar(ids);
    setAnuncio(`«${p.texto}» pasó a la posición ${destino + 1} de ${preguntas.length}.`);
  };
  const avisoBloqueo = 'Cierra las preguntas abiertas para poder moverlas.';

  return (
    <>
      {abiertas.size > 0 && <p className="m-0 text-[12.5px] font-bold text-accent-800">{avisoBloqueo}</p>}
      <p role="status" className="sr-only">
        {anuncio}
      </p>
      {visibles.map((p, i) => (
        <FilaPregunta
          key={p.id}
          pregunta={p}
          abierta={abiertas.has(p.id)}
          arrastrando={arrastre?.id === p.id}
          refFila={(n) => {
            if (n) filas.current.set(p.id, n);
            else filas.current.delete(p.id);
          }}
          onAlternar={() => {
            const siguiente = new Set(abiertas);
            if (!siguiente.delete(p.id)) siguiente.add(p.id);
            setAbiertas(siguiente);
          }}
          asa={
            <button
              type="button"
              aria-label={`Mover «${p.texto}». Usa las flechas arriba y abajo.`}
              aria-disabled={bloqueado}
              title={bloqueado ? avisoBloqueo : 'Arrastra para cambiar el orden'}
              onPointerDown={(e) => tomar(e, p.id)}
              onKeyDown={(e) => teclado(e, p, i)}
              className={`-ml-1.5 grid size-10 flex-none touch-none place-items-center rounded-full ${
                bloqueado
                  ? 'cursor-not-allowed text-neutral-500'
                  : arrastre
                    ? 'cursor-grabbing text-accent-700'
                    : 'cursor-grab text-neutral-700 hover:bg-accent-100'
              }`}
            >
              <Icon name="drag_indicator" size={22} />
            </button>
          }
        />
      ))}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </>
  );
}

function FilaPregunta({
  pregunta: p,
  abierta,
  arrastrando,
  refFila,
  onAlternar,
  asa,
}: {
  pregunta: Pregunta;
  abierta: boolean;
  arrastrando: boolean;
  refFila: (n: HTMLDivElement | null) => void;
  onAlternar: () => void;
  asa: ReactNode;
}) {
  const cliente = useQueryClient();
  const [error, setError] = useState<string>();
  const editar = useMutation({
    mutationFn: (body: components['schemas']['EditarPreguntaMatchDto']) =>
      datos(api.PATCH('/api/match/preguntas/{id}', { params: { path: { id: p.id } }, body })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['match', 'preguntas'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar la pregunta.'),
  });
  // Punto 27: las propias del centro se eliminan (con sus opciones); las del sistema solo se apagan.
  const [confirmar, setConfirmar] = useState(false);
  const eliminar = useMutation({
    mutationFn: () => datos(api.DELETE('/api/match/preguntas/{id}', { params: { path: { id: p.id } } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['match', 'preguntas'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos eliminar la pregunta.'),
  });
  return (
    <div
      ref={refFila}
      className={`rounded-[18px] border ${arrastrando ? 'border-accent-500 shadow-md' : 'border-divider'} ${p.activa ? 'bg-bg' : 'bg-neutral-100'}`}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {asa}
        <button type="button" aria-expanded={abierta} onClick={onAlternar} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          <Icon name={abierta ? 'expand_less' : 'expand_more'} size={20} className="flex-none text-neutral-700" />
          <span className="min-w-0">
            <span className={`block text-[14.5px] font-extrabold ${p.activa ? '' : 'text-neutral-700'}`}>{p.texto}</span>
            <span className="block text-[12px] font-semibold text-neutral-700">
              {TIPO[p.tipo]} · {p.opciones.filter((o) => o.activa).length} opciones{p.obligatoria ? ' · obligatoria' : ''}
            </span>
          </span>
        </button>
        {p.propiaCentro && <Badge>Propia del centro</Badge>}
        <Interruptor
          tono="team"
          etiqueta={<span className="sr-only">Mostrar «{p.texto}»</span>}
          activo={p.activa}
          deshabilitado={editar.isPending}
          onChange={(v) => editar.mutate({ activa: v })}
        />
      </div>
      {abierta && (
        <div className="flex flex-col gap-3 border-t border-divider px-4 py-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-bold">
            <input
              type="checkbox"
              checked={p.obligatoria}
              onChange={(e) => editar.mutate({ obligatoria: e.target.checked })}
              className="size-4 accent-accent-700"
            />
            Respuesta obligatoria
          </label>
          {p.ayuda && <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Ayuda: {p.ayuda}</p>}
          {['MULTIPLE', 'DIAS', 'FRANJAS'].includes(p.tipo) && (
            <span className="flex items-center gap-2 text-[13px] font-bold">
              Máximo que puede marcar
              <Input
                inputMode="numeric"
                defaultValue={p.maxSelecciones ? String(p.maxSelecciones) : ''}
                placeholder="Sin límite"
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= 20 && n !== p.maxSelecciones) editar.mutate({ maxSelecciones: n });
                }}
                className="!w-[110px] !py-1.5 !text-[13px]"
              />
            </span>
          )}
          <OpcionesPregunta pregunta={p} />
          {p.propiaCentro ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-3">
              {confirmar ? (
                <>
                  <span className="text-[13px] font-bold">¿Eliminar la pregunta y sus opciones? No se puede deshacer.</span>
                  <Button variant="ghost" onClick={() => setConfirmar(false)} className="!px-3 !py-1.5 !text-[13px]">
                    No
                  </Button>
                  <Button
                    variant="secondary"
                    icon="delete"
                    loading={eliminar.isPending}
                    onClick={() => eliminar.mutate()}
                    className="!px-3 !py-1.5 !text-[13px]"
                  >
                    Sí, eliminar
                  </Button>
                </>
              ) : (
                <Button variant="ghost" icon="delete" onClick={() => setConfirmar(true)} className="!px-3 !py-1.5 !text-[13px]">
                  Eliminar pregunta
                </Button>
              )}
            </div>
          ) : (
            <p className="m-0 text-[12px] font-semibold text-neutral-700">
              Pregunta del sistema: el match la usa para ordenar resultados. Se apaga, no se elimina.
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Limites del centro para dias y franjas (sin horario definido: todos los dias, todo el dia). */
function useLimitesCentro(): LimitesCentro {
  const h = useHorarioCentro().data ?? [];
  if (!h.length) return { dias: [1, 2, 3, 4, 5, 6, 7], inicio: 0, fin: 1440 };
  return {
    dias: [...new Set(h.map((x) => x.diaSemana))].sort((a, b) => a - b),
    inicio: Math.min(...h.map((x) => x.inicioMin)),
    fin: Math.max(...h.map((x) => x.finMin)),
  };
}

/** Opciones de una pregunta existente: se editan en borrador y se guardan juntas. */
function OpcionesPregunta({ pregunta }: { pregunta: Pregunta }) {
  const cliente = useQueryClient();
  const limites = useLimitesCentro();
  const inicial = () => [...pregunta.opciones].sort((a, b) => a.orden - b.orden).map(aBorrador);
  const [borrador, setBorrador] = useState(inicial);
  // Con cambios sin guardar, el sondeo (punto 10) no reemplaza el borrador.
  const [editado, setEditado] = useState(false);
  const [error, setError] = useState<string>();
  const sucio = JSON.stringify(borrador) !== JSON.stringify(inicial());
  const guardar = useMutation({
    mutationFn: () => guardarOpciones(pregunta, borrador),
    onSuccess: () => {
      setError(undefined);
      setEditado(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar las opciones.'),
    onSettled: () => cliente.invalidateQueries({ queryKey: ['match', 'preguntas'] }),
  });
  // Al recargar la pregunta (tras guardar) el borrador vuelve a lo guardado.
  const firma = JSON.stringify(pregunta.opciones);
  const [vista, setVista] = useState(firma);
  if (vista !== firma) {
    setVista(firma);
    if (!editado) setBorrador(inicial());
  }
  return (
    <div className="flex flex-col gap-2.5">
      <EditorOpciones
        tipo={pregunta.tipo}
        opciones={borrador}
        limites={limites}
        onChange={(b) => {
          setBorrador(b);
          setEditado(true);
        }}
      />
      {sucio && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-accent-100 px-3 py-2">
          <span className="text-[13px] font-bold">Tienes cambios sin guardar en las opciones.</span>
          <Button
            variant="ghost"
            onClick={() => {
              setBorrador(inicial());
              setEditado(false);
            }}
            className="!px-3 !py-1.5 !text-[13px]"
          >
            Descartar
          </Button>
          <Button
            variant="team"
            icon="check"
            loading={guardar.isPending}
            onClick={() => {
              const e = validar(pregunta.tipo, borrador, limites);
              if (e) return setError(e);
              guardar.mutate();
            }}
            className="!px-3 !py-1.5 !text-[13px]"
          >
            Guardar opciones
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </div>
  );
}

type Plantilla = { id: string; tipo: Pregunta['tipo']; titulo: string; detalle: string; icono: Icono; opciones: (l: LimitesCentro) => Borrador[] };
const PLANTILLAS: Plantilla[] = [
  {
    id: 'UNICA',
    tipo: 'UNICA',
    titulo: 'Una alternativa',
    detalle: 'El paciente elige una.',
    icono: 'radio_button_checked',
    opciones: () => [vacio(), vacio()],
  },
  { id: 'MULTIPLE', tipo: 'MULTIPLE', titulo: 'Varias alternativas', detalle: 'Puede marcar varias.', icono: 'check_box', opciones: () => [vacio(), vacio()] },
  { id: 'SI_NO', tipo: 'UNICA', titulo: 'Sí o no', detalle: 'Dos alternativas listas.', icono: 'check_circle', opciones: () => [vacio('Sí'), vacio('No')] },
  {
    id: 'ESCALA',
    tipo: 'ESCALA',
    titulo: 'Escala',
    detalle: 'Intensidad, frecuencia, acuerdo o números.',
    icono: 'format_list_numbered',
    opciones: () => escala('intensidad'),
  },
  { id: 'DIAS', tipo: 'DIAS', titulo: 'Días', detalle: 'Los días en que atiende el centro.', icono: 'calendar_month', opciones: diasDelCentro },
  {
    id: 'FRANJAS',
    tipo: 'FRANJAS',
    titulo: 'Franjas horarias',
    detalle: 'Bloques de horas dentro del horario.',
    icono: 'schedule',
    opciones: franjasPorDefecto,
  },
  {
    id: 'MODALIDAD',
    tipo: 'UNICA',
    titulo: 'Modalidad',
    detalle: 'Online, presencial o sin preferencia.',
    icono: 'swap_horiz',
    opciones: () => [
      vacio('Online', { criterio: 'MODALIDAD', objetivo: 'ONLINE', peso: 3, estricto: true }),
      vacio('Presencial', { criterio: 'MODALIDAD', objetivo: 'PRESENCIAL', peso: 3, estricto: true }),
      vacio('Sin preferencia'),
    ],
  },
  { id: 'TEXTO', tipo: 'TEXTO', titulo: 'Texto libre', detalle: 'Escribe con sus palabras; no puntúa.', icono: 'edit_note', opciones: () => [] },
];

function NuevaPregunta({ orden, tiposUsados, onCerrar }: { orden: number; tiposUsados: Pregunta['tipo'][]; onCerrar: () => void }) {
  const cliente = useQueryClient();
  const limites = useLimitesCentro();
  const [f, setF] = useState({ texto: '', ayuda: '', tipo: 'UNICA' as Pregunta['tipo'], obligatoria: false, maximo: '' });
  const [error, setError] = useState<string>();
  // Punto 28: se elige el tipo (plantilla) y las opciones se arman con su editor, no en una caja de texto.
  const [plantilla, setPlantilla] = useState('UNICA');
  const [opciones, setOpciones] = useState<Borrador[]>(() => PLANTILLAS[0].opciones(limites));
  const elegir = (t: Plantilla) => {
    setPlantilla(t.id);
    setF((y) => ({ ...y, tipo: t.tipo }));
    setOpciones(t.opciones(limites));
    setError(undefined);
  };
  const conMaximo = ['MULTIPLE', 'DIAS', 'FRANJAS'].includes(f.tipo);
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/match/preguntas', {
          body: {
            clave: `centro_${clave(f.texto)}`,
            texto: f.texto.trim(),
            ayuda: f.ayuda.trim() || undefined,
            tipo: f.tipo,
            orden,
            obligatoria: f.obligatoria,
            maxSelecciones: conMaximo && Number(f.maximo) >= 1 ? Math.min(20, Number(f.maximo)) : undefined,
            opciones: f.tipo === 'TEXTO' ? undefined : opcionesNuevas(f.tipo, opciones),
          },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['match', 'preguntas'] });
      onCerrar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos crear la pregunta.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (f.texto.trim().length < 5) return setError('Escribe la pregunta.');
    const invalido = validar(f.tipo, opciones, limites);
    if (invalido) return setError(invalido);
    crear.mutate();
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded-[18px] border-[1.5px] border-dashed border-neutral-400 p-4">
      <Field label="Pregunta" required>
        {(x) => <Input {...x} value={f.texto} maxLength={200} onChange={(e) => setF((y) => ({ ...y, texto: e.target.value }))} />}
      </Field>
      <Field label="Ayuda (opcional)" hint="Texto corto bajo la pregunta.">
        {(x) => <Input {...x} value={f.ayuda} maxLength={300} onChange={(e) => setF((y) => ({ ...y, ayuda: e.target.value }))} />}
      </Field>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-[13.5px] font-extrabold">Tipo de respuesta</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PLANTILLAS.map((t) => {
            // El match usa una sola pregunta de dias y una de franjas para cruzar la disponibilidad.
            const ocupado = (t.tipo === 'DIAS' || t.tipo === 'FRANJAS') && tiposUsados.includes(t.tipo);
            const activo = plantilla === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={activo}
                disabled={ocupado}
                title={ocupado ? 'El cuestionario ya tiene una pregunta de este tipo' : undefined}
                onClick={() => elegir(t)}
                className={`flex cursor-pointer items-start gap-2.5 rounded-[14px] border-[1.5px] px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${
                  activo ? 'border-accent-700 bg-accent-100' : 'border-divider bg-bg hover:border-accent-500'
                }`}
              >
                <Icon name={t.icono} size={20} className={`mt-0.5 flex-none ${activo ? 'text-accent-700' : 'text-neutral-700'}`} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-extrabold">{t.titulo}</span>
                  <span className="block text-[12px] font-semibold text-neutral-700">{ocupado ? 'Ya existe en el cuestionario' : t.detalle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="rounded-[14px] border border-divider p-3">
        <EditorOpciones tipo={f.tipo} opciones={opciones} limites={limites} onChange={setOpciones} />
      </div>
      {conMaximo && (
        <Field label="Máximo que puede marcar (opcional)" hint="Vacío: sin límite.">
          {(x) => (
            <Input
              {...x}
              inputMode="numeric"
              value={f.maximo}
              onChange={(e) => setF((y) => ({ ...y, maximo: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
              className="!w-[120px]"
            />
          )}
        </Field>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-bold">
        <input
          type="checkbox"
          checked={f.obligatoria}
          onChange={(e) => setF((y) => ({ ...y, obligatoria: e.target.checked }))}
          className="size-4 accent-accent-700"
        />
        Respuesta obligatoria
      </label>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">Se crea activa, con sus opciones.</p>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button type="submit" variant="team" loading={crear.isPending}>
          Agregar
        </Button>
      </div>
    </form>
  );
}

function FiltroDirecto() {
  const configuracion = useConfiguracionCentro();
  const cliente = useQueryClient();
  const guardar = useMutation({
    mutationFn: (body: components['schemas']['EditarConfiguracionDto']) => datos(api.PATCH('/api/configuracion', { body })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['configuracion'] }),
  });
  return (
    <Panel titulo="Filtro directo" bajada="Permite al paciente saltarse el cuestionario y filtrar el equipo por su cuenta.">
      <div className="mt-4 flex flex-col gap-4">
        <EstadoConsulta consulta={configuracion}>
          {(c) => (
            <>
              <Interruptor
                tono="team"
                etiqueta="Mostrar «Prefiero filtrar yo mismo»"
                descripcion={c.matchFiltroDirecto ? 'El paciente puede elegir entre el cuestionario y el filtro.' : 'Solo se ofrece el cuestionario.'}
                activo={c.matchFiltroDirecto}
                deshabilitado={guardar.isPending}
                onChange={(v) => guardar.mutate({ matchFiltroDirecto: v })}
              />
              <Field label="Días que se guardan las respuestas si no agenda" hint="Entre 1 y 365. Después se borran.">
                {(x) => (
                  <Input
                    {...x}
                    inputMode="numeric"
                    defaultValue={String(c.diasRetencionRespuestasMatch)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 1 && n <= 365 && n !== c.diasRetencionRespuestasMatch) guardar.mutate({ diasRetencionRespuestasMatch: n });
                    }}
                    className="!w-[120px]"
                  />
                )}
              </Field>
            </>
          )}
        </EstadoConsulta>
        {guardar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar.'}
          </p>
        )}
      </div>
    </Panel>
  );
}

function Metricas() {
  const metricas = useQuery({ queryKey: ['match', 'metricas'], queryFn: () => datos(api.GET('/api/match/metricas', { params: { query: { dias: 30 } } })) });
  return (
    <Panel titulo="Métricas básicas" bajada="Últimos 30 días.">
      <div className="mt-4">
        <EstadoConsulta consulta={metricas}>
          {(m) => {
            const conversion = m.solicitudes_con_match ? Math.round((m.agendaron_con_recomendado / m.solicitudes_con_match) * 100) : 0;
            return (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Cuestionarios completados', String(m.completados)],
                    ['Solicitudes con match', String(m.solicitudes_con_match)],
                    ['Agendaron con el recomendado', m.solicitudes_con_match ? `${conversion}%` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[14px] border border-divider bg-bg px-3 py-3">
                      <div className="text-[24px] font-black tracking-[-0.03em] tabular-nums">{v}</div>
                      <div className="text-[12px] font-bold text-neutral-800">{k}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="m-0 mb-2 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Más recomendados en el período</p>
                  {m.ranking.length === 0 ? (
                    <p className="m-0 text-[13px] font-semibold text-neutral-800">Todavía no hay recomendaciones.</p>
                  ) : (
                    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {m.ranking.map((r, i) => (
                        <li key={r.profesional_id} className="flex items-center gap-3 text-[13.5px] font-bold">
                          <span className="w-5 text-neutral-700 tabular-nums">{i + 1}.</span>
                          <span className="min-w-0 flex-1">{r.nombre ?? 'Profesional'}</span>
                          <span className="tabular-nums">{r.recomendaciones}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            );
          }}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}
