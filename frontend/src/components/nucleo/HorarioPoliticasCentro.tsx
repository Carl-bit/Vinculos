'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useHorarioCentro, usePoliticas, type HorarioCentro, type PoliticaVista } from '@/lib/centro';
import { formatoFecha } from '@/lib/formato';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutos = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

interface Dia {
  abre: boolean;
  inicio: string;
  fin: string;
}

const diasDesde = (h: HorarioCentro[]): Dia[] =>
  DIAS.map((_, i) => {
    const b = h.find((x) => x.diaSemana === i + 1);
    return b ? { abre: true, inicio: hhmm(b.inicioMin), fin: hhmm(b.finMin) } : { abre: false, inicio: '09:00', fin: '20:00' };
  });

/**
 * Horario general del centro: limite de toda cita (y de los horarios de box).
 * Sin filas = sin restriccion propia. No mueve citas ya agendadas.
 */
export function HorarioCentroEditor() {
  const horario = useHorarioCentro();
  return <EstadoConsulta consulta={horario}>{(h) => <EditorHorario key={h.map((x) => x.id).join()} inicial={h} />}</EstadoConsulta>;
}

function EditorHorario({ inicial }: { inicial: HorarioCentro[] }) {
  const cliente = useQueryClient();
  const [dias, setDias] = useState<Dia[]>(diasDesde(inicial));
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/configuracion/horario', {
          body: { bloques: dias.flatMap((d, i) => (d.abre ? [{ diaSemana: i + 1, inicioMin: minutos(d.inicio), finMin: minutos(d.fin) }] : [])) },
        }),
      ),
    onSuccess: () => {
      setError(undefined);
      setGuardado(true);
      void cliente.invalidateQueries({ queryKey: ['configuracion', 'horario'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el horario.'),
  });
  const cambiar = (i: number, c: Partial<Dia>) => {
    setGuardado(false);
    setDias((l) => l.map((d, j) => (j === i ? { ...d, ...c } : d)));
  };
  return (
    <Panel
      titulo="Horario general de atención"
      bajada="Horario base del centro: ninguna cita ni horario de box puede quedar fuera. Los boxes se ajustan dentro de Agenda y Espacios."
    >
      <div className="mt-4 flex flex-col gap-2">
        {dias.map((d, i) => (
          <div key={DIAS[i]} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-bg px-3.5 py-2">
            <label className="flex w-[118px] cursor-pointer items-center gap-2 text-[13.5px] font-extrabold">
              <input type="checkbox" checked={d.abre} onChange={(e) => cambiar(i, { abre: e.target.checked })} className="size-4 accent-accent-700" />
              {DIAS[i]}
            </label>
            {d.abre ? (
              <span className="flex items-center gap-2">
                <Input
                  type="time"
                  step={900}
                  aria-label={`${DIAS[i]}: abre`}
                  value={d.inicio}
                  onChange={(e) => cambiar(i, { inicio: e.target.value })}
                  className="!w-[150px] !py-2"
                />
                <span className="text-[13px] font-bold text-neutral-700">a</span>
                <Input
                  type="time"
                  step={900}
                  aria-label={`${DIAS[i]}: cierra`}
                  value={d.fin}
                  onChange={(e) => cambiar(i, { fin: e.target.value })}
                  className="!w-[150px] !py-2"
                />
              </span>
            ) : (
              <span className="text-[13px] font-semibold text-neutral-700">Cerrado</span>
            )}
          </div>
        ))}
        <p className="m-0 mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
          <Icon name="calendar_month" size={17} />
          Las citas ya agendadas no se mueven; las nuevas deben caer dentro.{' '}
          <Link href="/admin/agenda?vista=espacios" className="font-extrabold text-accent-700 underline underline-offset-2">
            Ir a Agenda y Espacios
          </Link>
        </p>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {guardado && (
            <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
              Horario guardado.
            </p>
          )}
          <Button
            variant="team"
            icon="save"
            loading={guardar.isPending}
            onClick={() =>
              dias.some((d) => d.abre && minutos(d.fin) <= minutos(d.inicio))
                ? setError('En cada día, el cierre debe ser posterior a la apertura.')
                : guardar.mutate()
            }
          >
            Guardar horario
          </Button>
        </div>
      </div>
    </Panel>
  );
}

const TIPOS: { tipo: PoliticaVista['tipo']; titulo: string; bajada: string }[] = [
  {
    tipo: 'CONSENTIMIENTO_ATENCION',
    titulo: 'Consentimiento informado',
    bajada: 'Se muestra a cada paciente y debe aceptarse de forma explícita (Ley 20.584 y Ley 21.719).',
  },
  { tipo: 'POLITICA_DATOS', titulo: 'Política de datos personales', bajada: 'Tratamiento de datos del paciente; se acepta al registrarse o pedir hora.' },
  { tipo: 'TERMINOS_AGENDAMIENTO', titulo: 'Términos de agendamiento', bajada: 'Cancelación, inasistencia y pagos; se aceptan al reservar.' },
  {
    tipo: 'CONSENTIMIENTO_PRACTICANTE',
    titulo: 'Consentimiento de atención con practicante',
    bajada: 'Lo acepta el paciente (o su adulto responsable) antes de que lo atienda un practicante supervisado.',
  },
];

/**
 * Politicas versionadas: nunca se edita una version publicada; publicar crea
 * la siguiente y desde ahi se pide aceptar la nueva. Reglas del sistema
 * (menores, retencion de fichas) se muestran fijas.
 */
export function PoliticasCentro() {
  const politicas = usePoliticas();
  return (
    <div className="flex flex-col gap-6">
      <EstadoConsulta consulta={politicas}>
        {(l) => (
          <>
            {TIPOS.map((t) => (
              <PoliticaTipo key={t.tipo} {...t} versiones={l.filter((p) => p.tipo === t.tipo)} />
            ))}
          </>
        )}
      </EstadoConsulta>
      <Panel titulo="Reglas del sistema" bajada="Vienen de la normativa: el centro no las cambia.">
        <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          {[
            'Un paciente menor de 18 años necesita un adulto responsable registrado antes de confirmar su primera hora.',
            'Las fichas clínicas se conservan al menos 15 años desde la última atención (Decreto 41, Ley 20.584), aunque el profesional deje el centro. Nunca se borran.',
            'El acceso a la ficha de otro profesional solo se da por derivación o acceso temporal registrado, nunca cambiando el rol.',
          ].map((r) => (
            <li key={r} className="flex items-start gap-3 text-[13.5px] font-semibold text-neutral-800">
              <Icon name="lock" size={18} className="mt-0.5 flex-none text-neutral-700" />
              {r}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function PoliticaTipo({ tipo, titulo, bajada, versiones }: { tipo: PoliticaVista['tipo']; titulo: string; bajada: string; versiones: PoliticaVista[] }) {
  const cliente = useQueryClient();
  const vigente = versiones[0];
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(vigente?.texto ?? '');
  const [error, setError] = useState<string>();
  const publicar = useMutation({
    mutationFn: () => datos(api.POST('/api/politicas', { body: { tipo, texto: texto.trim() } })),
    onSuccess: () => {
      setEditando(false);
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['configuracion', 'politicas'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos publicar la nueva versión.'),
  });
  return (
    <Panel
      titulo={titulo}
      bajada={bajada}
      accion={
        vigente ? (
          <Badge tono="positivo">
            Versión {vigente.version} · desde {formatoFecha(vigente.vigenteDesde)}
          </Badge>
        ) : (
          <Badge tono="atencion">Sin publicar</Badge>
        )
      }
    >
      <div className="mt-4 flex flex-col gap-3">
        {editando ? (
          <>
            <Field label="Texto de la nueva versión" hint="Mínimo 20 caracteres. Al publicar, los pacientes deberán aceptar esta versión.">
              {(x) => <Textarea {...x} rows={8} maxLength={50000} value={texto} onChange={(e) => setTexto(e.target.value)} />}
            </Field>
            <Aviso tono="nota">La versión anterior queda guardada tal cual, con sus aceptaciones.</Aviso>
            {error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2.5">
              <Button variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button
                variant="team"
                disabled={texto.trim().length < 20 || texto.trim() === vigente?.texto}
                loading={publicar.isPending}
                onClick={() => publicar.mutate()}
              >
                Publicar versión {(vigente?.version ?? 0) + 1}
              </Button>
            </div>
          </>
        ) : (
          <>
            {vigente ? (
              <p className="m-0 max-h-[160px] overflow-y-auto rounded-[14px] border border-divider bg-bg p-4 text-[13.5px] leading-relaxed whitespace-pre-line text-neutral-800">
                {vigente.texto}
              </p>
            ) : (
              <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Todavía no hay texto publicado.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {versiones.length > 1 && (
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700">
                  <Icon name="history" size={16} />
                  {versiones.length - 1} {versiones.length === 2 ? 'versión anterior' : 'versiones anteriores'}
                </span>
              )}
              <Button
                variant="secondary"
                icon="edit"
                onClick={() => {
                  setTexto(vigente?.texto ?? '');
                  setEditando(true);
                }}
                className="ml-auto !py-2.5"
              >
                {vigente ? 'Nueva versión' : 'Publicar'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
