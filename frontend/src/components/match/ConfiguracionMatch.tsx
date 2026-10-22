'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Encabezado } from '@/components/shared/Encabezado';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro } from '@/lib/centro';
import { useModulos } from '@/lib/consultas';

type Pregunta = components['schemas']['MatchPreguntaVista'];
type Opcion = components['schemas']['MatchOpcionVista'];
type Criterio = NonNullable<Opcion['criterio']>;

const TIPO: Record<Pregunta['tipo'], string> = {
  UNICA: 'Una opción',
  MULTIPLE: 'Varias opciones',
  ESCALA: 'Escala',
  TEXTO: 'Texto libre',
  DIAS: 'Días',
  FRANJAS: 'Franjas horarias',
};
const CRITERIO: Record<Criterio, string> = {
  TIPO_ATENCION: 'Tipo de atención',
  ENFOQUE: 'Enfoque',
  ESPECIALIDAD: 'Especialidad',
  MODALIDAD: 'Modalidad',
  PREVISION: 'Previsión',
  PRESUPUESTO: 'Presupuesto (tope en CLP)',
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
        <Panel
          titulo="Preguntas del cuestionario"
          bajada="Las preguntas apagadas no se le muestran al paciente ni se usan para filtrar."
          accion={preguntas.data ? <Badge>{`${preguntas.data.filter((p) => p.activa).length} de ${preguntas.data.length} activas`}</Badge> : undefined}
        >
          <div className="mt-4 flex flex-col gap-2.5">
            <EstadoConsulta consulta={preguntas} vacio={(l) => l.length === 0} textoVacio="Sin preguntas">
              {(l) => l.map((p) => <FilaPregunta key={p.id} pregunta={p} />)}
            </EstadoConsulta>
            {nueva ? (
              <NuevaPregunta orden={Math.max(0, ...(preguntas.data ?? []).map((p) => p.orden)) + 1} onCerrar={() => setNueva(false)} />
            ) : (
              <Button variant="secondary" icon="add" onClick={() => setNueva(true)} className="self-start !py-2.5">
                Agregar pregunta propia del centro
              </Button>
            )}
          </div>
        </Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <FiltroDirecto />
          <Metricas />
        </div>
        <Panel titulo="Dependencias del módulo" bajada="El match usa datos de otros módulos del centro.">
          <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
            {[
              { id: 'EQUIPO', nombre: 'Equipo', nota: 'Perfiles publicados y tipos de atención aprobados', tipo: 'Requerido' },
              { id: 'AGENDA', nombre: 'Agenda y Espacios', nota: 'Disponibilidad real en los resultados', tipo: 'Opcional' },
            ].map((d) => {
              const activo = activos.includes(d.id as (typeof activos)[number]);
              return (
                <li
                  key={d.id}
                  className={`flex items-start gap-3 rounded-[18px] border px-4 py-3 ${activo ? 'border-accent-2-500 bg-accent-2-200' : 'border-divider bg-neutral-100'}`}
                >
                  <Icon name={d.id === 'EQUIPO' ? 'groups' : 'calendar_month'} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[14px] font-extrabold">{d.nombre}</p>
                    <p className="m-0 text-[12.5px] font-semibold text-neutral-800">{d.nota}</p>
                  </div>
                  <Badge tono={activo ? 'positivo' : 'neutro'}>{`${d.tipo} · ${activo ? 'activo' : 'inactivo'}`}</Badge>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function FilaPregunta({ pregunta: p }: { pregunta: Pregunta }) {
  const cliente = useQueryClient();
  const [abierta, setAbierta] = useState(false);
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
  return (
    <div className={`rounded-[18px] border ${p.activa ? 'border-divider bg-bg' : 'border-divider bg-neutral-100'}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={abierta}
          onClick={() => setAbierta((a) => !a)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
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
          {['UNICA', 'MULTIPLE', 'ESCALA'].includes(p.tipo) && <Opciones pregunta={p} />}
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

function Opciones({ pregunta }: { pregunta: Pregunta }) {
  const cliente = useQueryClient();
  const [etiqueta, setEtiqueta] = useState('');
  const [error, setError] = useState<string>();
  const refrescar = () => {
    setError(undefined);
    void cliente.invalidateQueries({ queryKey: ['match', 'preguntas'] });
  };
  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar la opción.');
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: components['schemas']['EditarOpcionMatchDto'] }) =>
      datos(api.PATCH('/api/match/opciones/{id}', { params: { path: { id } }, body })),
    onSuccess: refrescar,
    onError: fallo,
  });
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/match/preguntas/{id}/opciones', {
          params: { path: { id: pregunta.id } },
          body: { valor: clave(etiqueta) || 'opcion', etiqueta: etiqueta.trim(), orden: Math.max(0, ...pregunta.opciones.map((o) => o.orden)) + 1 },
        }),
      ),
    onSuccess: () => {
      setEtiqueta('');
      refrescar();
    },
    onError: fallo,
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Opciones y cómo puntúan</p>
      {pregunta.opciones.map((o) => (
        <div
          key={o.id}
          className={`grid gap-2 rounded-[14px] border border-divider px-3 py-2.5 sm:grid-cols-[1.4fr_1fr_1fr_90px_auto] sm:items-center ${o.activa ? 'bg-bg' : 'bg-neutral-100'}`}
        >
          <Input
            aria-label={`Texto de la opción «${o.etiqueta}»`}
            defaultValue={o.etiqueta}
            onBlur={(e) =>
              e.target.value.trim() && e.target.value.trim() !== o.etiqueta && editar.mutate({ id: o.id, body: { etiqueta: e.target.value.trim() } })
            }
            className={`!py-1.5 !text-[13.5px] !font-bold ${o.activa ? '' : 'text-neutral-700 line-through'}`}
          />
          <Select
            aria-label={`Criterio de «${o.etiqueta}»`}
            value={o.criterio ?? ''}
            onChange={(e) => editar.mutate({ id: o.id, body: { criterio: (e.target.value || undefined) as Criterio | undefined } })}
            className="!py-1.5 !text-[13px]"
          >
            <option value="">Sin criterio</option>
            {(Object.keys(CRITERIO) as Criterio[]).map((c) => (
              <option key={c} value={c}>
                {CRITERIO[c]}
              </option>
            ))}
          </Select>
          <Input
            aria-label={`Valor que busca «${o.etiqueta}»`}
            placeholder={o.criterio === 'PRESUPUESTO' ? 'Tope en CLP (p. ej. 35000)' : 'Valor (p. ej. Parejas)'}
            defaultValue={o.objetivo ?? ''}
            onBlur={(e) => e.target.value !== (o.objetivo ?? '') && editar.mutate({ id: o.id, body: { objetivo: e.target.value.trim() } })}
            className="!py-1.5 !text-[13px]"
          />
          <Input
            aria-label={`Peso de «${o.etiqueta}»`}
            inputMode="numeric"
            defaultValue={String(o.peso)}
            onBlur={(e) => Number(e.target.value) !== o.peso && editar.mutate({ id: o.id, body: { peso: Number(e.target.value) || 0 } })}
            className="!py-1.5 !text-[13px]"
          />
          <div className="flex items-center gap-1.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold" title="Estricto: descarta a quien no cumple">
              <input
                type="checkbox"
                checked={o.estricto}
                onChange={(e) => editar.mutate({ id: o.id, body: { estricto: e.target.checked } })}
                className="size-4 accent-accent-700"
              />
              Estricto
            </label>
            <button
              type="button"
              onClick={() => editar.mutate({ id: o.id, body: { activa: !o.activa } })}
              className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
            >
              {o.activa ? 'Apagar' : 'Activar'}
            </button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Nueva opción"
          placeholder="Nueva opción"
          value={etiqueta}
          maxLength={120}
          onChange={(e) => setEtiqueta(e.target.value)}
          className="!max-w-[280px] !py-2"
        />
        <Button
          variant="secondary"
          icon="add"
          disabled={etiqueta.trim().length < 2}
          loading={crear.isPending}
          onClick={() => crear.mutate()}
          className="!py-2.5"
        >
          Agregar opción
        </Button>
      </div>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">
        El peso suma puntos al profesional que cumple el criterio; «estricto» descarta a quien no lo cumple.
      </p>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </div>
  );
}

function NuevaPregunta({ orden, onCerrar }: { orden: number; onCerrar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ texto: '', ayuda: '', tipo: 'UNICA' as Pregunta['tipo'], obligatoria: false });
  const [error, setError] = useState<string>();
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
    crear.mutate();
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded-[18px] border-[1.5px] border-dashed border-neutral-400 p-4">
      <Field label="Pregunta" required>
        {(x) => <Input {...x} value={f.texto} maxLength={200} onChange={(e) => setF((y) => ({ ...y, texto: e.target.value }))} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de respuesta">
          {(x) => (
            <Select {...x} value={f.tipo} onChange={(e) => setF((y) => ({ ...y, tipo: e.target.value as Pregunta['tipo'] }))}>
              {(Object.keys(TIPO) as Pregunta['tipo'][]).map((t) => (
                <option key={t} value={t}>
                  {TIPO[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Ayuda (opcional)">
          {(x) => <Input {...x} value={f.ayuda} maxLength={300} onChange={(e) => setF((y) => ({ ...y, ayuda: e.target.value }))} />}
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-bold">
        <input
          type="checkbox"
          checked={f.obligatoria}
          onChange={(e) => setF((y) => ({ ...y, obligatoria: e.target.checked }))}
          className="size-4 accent-accent-700"
        />
        Respuesta obligatoria
      </label>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">Después de crearla, agrégale opciones y su criterio. Nace activa.</p>
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
                      <div className="text-[11.5px] font-bold text-neutral-800">{k}</div>
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
