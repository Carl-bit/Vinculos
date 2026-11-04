'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { LecturasProtocolo } from '@/components/nucleo/ProtocoloEquipo';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useDirectorioEquipo, useHorarioCentro, useLecturasProtocolo, usePoliticas, type HorarioCentro, type PoliticaVista } from '@/lib/centro';
import { formatoFecha } from '@/lib/formato';

import { BarraGuardado } from './BarraGuardado';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutos = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

interface Tramo {
  inicio: string;
  fin: string;
}
interface Dia {
  abre: boolean;
  /** Uno, o dos con una pausa entre medio (filas de horario_centro del mismo dia). */
  tramos: Tramo[];
}

const diasDesde = (h: HorarioCentro[]): Dia[] =>
  DIAS.map((_, i) => {
    const filas = h.filter((x) => x.diaSemana === i + 1).sort((a, b) => a.inicioMin - b.inicioMin);
    return filas.length
      ? { abre: true, tramos: filas.map((b) => ({ inicio: hhmm(b.inicioMin), fin: hhmm(b.finMin) })) }
      : { abre: false, tramos: [{ inicio: '09:00', fin: '20:00' }] };
  });

/** Mensaje si algun dia abierto tiene tramos invalidos o que se pisan; null si esta bien. */
function errorHorario(dias: Dia[]): string | null {
  for (const [i, d] of dias.entries()) {
    if (!d.abre) continue;
    const t = d.tramos.map((x) => [minutos(x.inicio), minutos(x.fin || '24:00') || 1440] as const);
    if (t.some(([a, b]) => b <= a)) return `${DIAS[i]}: el cierre debe ser posterior a la apertura.`;
    if (t.some(([a], k) => k > 0 && a < t[k - 1]![1])) return `${DIAS[i]}: la pausa debe quedar entre los dos tramos.`;
  }
  return null;
}

/**
 * Sin dias de atencion el centro esta cerrado (2026-11-05): los boxes son
 * espacios fisicos y nadie aparta box ni agenda fuera del horario del centro.
 */
export function AvisoSinHorario() {
  const horario = useHorarioCentro();
  if (horario.data?.length !== 0) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-[14px] border border-pendiente-700/40 bg-pendiente-100 px-4 py-3.5 text-[13.5px] text-pendiente-900"
    >
      <Icon name="warning" size={20} className="mt-px flex-none" />
      <span>
        <strong>El centro figura cerrado todos los días.</strong> Nadie puede agendar ni abrir horarios de box hasta que definas al menos un día.
      </span>
    </div>
  );
}

/** Horario general del centro: limite de toda cita y de los horarios de box. No mueve citas ya agendadas. */
export function HorarioCentroEditor() {
  const horario = useHorarioCentro();
  const [descartes, setDescartes] = useState(0);
  return (
    <EstadoConsulta consulta={horario}>
      {(h) => <EditorHorario key={`${h.map((x) => x.id).join()}-${descartes}`} inicial={h} onDescartar={() => setDescartes((n) => n + 1)} />}
    </EstadoConsulta>
  );
}

function EditorHorario({ inicial, onDescartar }: { inicial: HorarioCentro[]; onDescartar: () => void }) {
  const cliente = useQueryClient();
  const [dias, setDias] = useState<Dia[]>(diasDesde(inicial));
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  const [cambiado, setCambiado] = useState(false);
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/configuracion/horario', {
          body: {
            bloques: dias.flatMap((d, i) =>
              d.abre ? d.tramos.map((t) => ({ diaSemana: i + 1, inicioMin: minutos(t.inicio), finMin: minutos(t.fin) || 1440 })) : [],
            ),
          },
        }),
      ),
    onSuccess: () => {
      setError(undefined);
      setGuardado(true);
      void cliente.invalidateQueries({ queryKey: ['configuracion', 'horario'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el horario.'),
  });
  const cambiar = (i: number, c: (d: Dia) => Dia) => {
    setGuardado(false);
    setCambiado(true);
    setDias((l) => l.map((d, j) => (j === i ? c(d) : d)));
  };
  const tramo = (i: number, k: number, campo: keyof Tramo, valor: string) =>
    cambiar(i, (d) => ({ ...d, tramos: d.tramos.map((t, j) => (j === k ? { ...t, [campo]: valor } : t)) }));
  /** Pausa de una hora a mitad del tramo (redondeada a la hora); quitarla une los dos tramos. */
  const pausa = (i: number) =>
    cambiar(i, (d) => {
      if (d.tramos.length > 1) return { ...d, tramos: [{ inicio: d.tramos[0]!.inicio, fin: d.tramos.at(-1)!.fin }] };
      const [t] = d.tramos;
      const medio = Math.floor((minutos(t!.inicio) + (minutos(t!.fin) || 1440)) / 120) * 60;
      return {
        ...d,
        tramos: [
          { inicio: t!.inicio, fin: hhmm(medio) },
          { inicio: hhmm(Math.min(medio + 60, 1439)), fin: t!.fin },
        ],
      };
    });
  const enviar = () => {
    const problema = errorHorario(dias);
    if (problema) return setError(problema);
    guardar.mutate();
  };
  return (
    <div className="flex flex-col gap-[18px]">
      <Panel
        titulo="Horario general"
        bajada="Ninguna cita ni horario de box puede quedar fuera. Las citas ya agendadas no se mueven."
        nivel={3}
        accion={
          <Button
            variant="secondary"
            className="!min-h-9 !py-1.5 !text-[13px]"
            onClick={() => {
              setGuardado(false);
              setCambiado(true);
              setDias((l) => l.map((d, i) => (i < 5 ? { abre: true, tramos: [{ inicio: '09:00', fin: '20:00' }] } : d)));
            }}
          >
            Lunes a viernes, 09:00 a 20:00
          </Button>
        }
      >
        <div className="flex flex-col gap-1.5">
          {dias.map((d, i) => (
            <div
              key={DIAS[i]}
              className={`flex min-h-[52px] flex-wrap items-center gap-3 rounded-[12px] px-3 py-1 ${d.abre ? 'border border-divider bg-bg' : 'border border-transparent'}`}
            >
              <button
                type="button"
                role="switch"
                aria-checked={d.abre}
                aria-label={`Abrir el ${DIAS[i]!.toLowerCase()}`}
                onClick={() => cambiar(i, (x) => ({ ...x, abre: !x.abre }))}
                className={`relative h-7 w-12 flex-none cursor-pointer rounded-full border-[1.5px] transition-colors duration-200 ease-out ${
                  d.abre ? 'border-accent-2-700 bg-accent-2-700' : 'border-neutral-400 bg-neutral-200'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-1/2 left-[3px] size-5 -translate-y-1/2 rounded-full bg-neutral-100 shadow-sm transition-transform duration-200 ease-out ${d.abre ? 'translate-x-5' : ''}`}
                />
              </button>
              <span className="w-[92px] text-[14px] font-extrabold">{DIAS[i]}</span>
              {d.abre ? (
                <>
                  {d.tramos.map((t, k) => (
                    <span key={k} className="flex items-center gap-2">
                      {k > 0 && <span className="text-[12px] font-bold text-neutral-700">pausa ·</span>}
                      <Input
                        type="time"
                        step={900}
                        aria-label={`${DIAS[i]}: ${k > 0 ? 'vuelve' : 'abre'}`}
                        value={t.inicio}
                        onChange={(e) => tramo(i, k, 'inicio', e.target.value)}
                        className="!w-[130px] !py-2"
                      />
                      <span className="text-[13px] font-bold text-neutral-700">a</span>
                      <Input
                        type="time"
                        step={900}
                        aria-label={`${DIAS[i]}: ${k < d.tramos.length - 1 ? 'pausa desde' : 'cierra'}`}
                        value={t.fin}
                        onChange={(e) => tramo(i, k, 'fin', e.target.value)}
                        className="!w-[130px] !py-2"
                      />
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => pausa(i)}
                    className="min-h-9 cursor-pointer rounded-full px-2.5 text-[13px] font-extrabold text-accent-700 hover:bg-accent-100"
                  >
                    {d.tramos.length > 1 ? 'Quitar pausa' : 'Agregar pausa'}
                  </button>
                </>
              ) : (
                <span className="text-[13px] font-semibold text-neutral-700">Cerrado</span>
              )}
            </div>
          ))}
          <Link href="/admin/agenda?vista=espacios" className="mt-1 flex items-center gap-1.5 text-[13px] font-extrabold text-accent-700">
            <Icon name="calendar_month" size={17} />
            Ajustar horarios por box en Agenda y Espacios
          </Link>
        </div>
      </Panel>
      <BarraGuardado
        seccion="Horario general"
        error={error}
        guardado={guardado}
        cambiado={cambiado}
        guardando={guardar.isPending}
        onDescartar={onDescartar}
        onGuardar={enviar}
      />
    </div>
  );
}

const TIPOS: { tipo: PoliticaVista['tipo']; titulo: string; bajada: string; equipo?: boolean }[] = [
  {
    tipo: 'CONSENTIMIENTO_ATENCION',
    titulo: 'Consentimiento informado',
    bajada: 'Se muestra a cada paciente y debe aceptarse de forma explícita.',
  },
  { tipo: 'POLITICA_DATOS', titulo: 'Política de datos personales', bajada: 'Se acepta al registrarse o pedir hora.' },
  { tipo: 'TERMINOS_AGENDAMIENTO', titulo: 'Términos de agendamiento', bajada: 'Cancelación, inasistencia y pagos; se aceptan al reservar.' },
  {
    tipo: 'CONSENTIMIENTO_PRACTICANTE',
    titulo: 'Consentimiento de atención con practicante',
    bajada: 'Lo acepta el paciente (o su adulto responsable) antes de que lo atienda un practicante.',
  },
  { tipo: 'PROTOCOLO_PACIENTE', titulo: 'Protocolo para pacientes', bajada: 'El paciente confirma en su portal que lo leyó.' },
  {
    tipo: 'PROTOCOLO_EQUIPO',
    titulo: 'Protocolo interno del equipo',
    bajada: 'Solo lo ve el equipo; una versión nueva vuelve a quedar pendiente.',
    equipo: true,
  },
];

const REGLAS_SISTEMA: [string, string][] = [
  ['Menores de 18 años', 'Necesitan un adulto responsable registrado antes de su primera hora.'],
  ['Conservación de fichas', 'Al menos 15 años desde la última atención (Decreto 41, Ley 20.584). Nunca se borran.'],
  ['Acceso a fichas ajenas', 'Solo por derivación o acceso temporal registrado, nunca cambiando el rol.'],
];

/**
 * Politicas versionadas (diseño "Opcion A submenu agrupado"): una fila por
 * documento con su version vigente; nunca se edita una version publicada,
 * publicar crea la siguiente y desde ahi se pide aceptar la nueva. Reglas del
 * sistema (menores, retencion de fichas) fijas.
 */
export function PoliticasCentro() {
  const politicas = usePoliticas();
  return (
    <div className="flex flex-col gap-[18px]">
      <EstadoConsulta consulta={politicas}>
        {(l) => (
          <>
            <Panel titulo="Documentos para pacientes" bajada="Se aceptan de forma explícita (Ley 20.584 y Ley 21.719)." nivel={3}>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {TIPOS.filter((t) => !t.equipo).map((t) => (
                  <PoliticaTipo key={t.tipo} {...t} versiones={l.filter((p) => p.tipo === t.tipo)} />
                ))}
              </ul>
            </Panel>
            <Panel titulo="Documentos del equipo" bajada="Cada integrante lo marca como leído en Mi perfil." nivel={3}>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {TIPOS.filter((t) => t.equipo).map((t) => (
                  <PoliticaTipo key={t.tipo} {...t} versiones={l.filter((p) => p.tipo === t.tipo)}>
                    {l.some((p) => p.tipo === t.tipo) && <LecturasResumen />}
                  </PoliticaTipo>
                ))}
              </ul>
            </Panel>
          </>
        )}
      </EstadoConsulta>
      <Panel titulo="Reglas del sistema" bajada="Vienen de la normativa: el centro no las cambia." nivel={3}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {REGLAS_SISTEMA.map(([titulo, texto]) => (
            <li key={titulo} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-divider bg-bg px-3 py-2.5">
              <span className="flex min-w-0 flex-[1_1_260px] flex-col">
                <strong className="text-[14px]">{titulo}</strong>
                <span className="text-[12px] font-semibold text-neutral-700">{texto}</span>
              </span>
              <Badge tono="neutro">Fija</Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** Lecturas del protocolo vigente: resumen y, a pedido, quien falta. "Recordar" es de ejemplo (sin endpoint). */
function LecturasResumen() {
  const lecturas = useLecturasProtocolo(true);
  const directorio = useDirectorioEquipo(true);
  const [abierta, setAbierta] = useState(false);
  const equipo = (directorio.data ?? []).filter((m) => m.roles.some((r) => r !== 'PACIENTE' && r !== 'RESPONSABLE'));
  const leidos = new Set(lecturas.data?.map((x) => x.usuarioId));
  const pendientes = equipo.filter((m) => !leidos.has(m.id)).length;
  if (!lecturas.data) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-divider pt-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[12.5px] font-semibold text-neutral-800">
          {lecturas.data.length} de {equipo.length} {equipo.length === 1 ? 'integrante lo leyó' : 'integrantes lo leyeron'}
        </span>
        {pendientes > 0 && <Badge tono="atencion">{`${pendientes} pendiente${pendientes === 1 ? '' : 's'}`}</Badge>}
        <button
          type="button"
          aria-expanded={abierta}
          onClick={() => setAbierta((v) => !v)}
          className="min-h-9 cursor-pointer rounded-full px-2 text-[13px] font-extrabold text-accent-700 underline underline-offset-2"
        >
          {abierta ? 'Ocultar quién falta' : 'Ver quién falta'}
        </button>
        {pendientes > 0 && (
          <button
            type="button"
            disabled
            title="Aún no disponible: cada integrante ve el aviso en Mi perfil."
            className="ml-auto min-h-9 cursor-not-allowed rounded-full border border-divider bg-surface px-3.5 text-[13px] font-extrabold opacity-60"
          >
            Recordar a pendientes
          </button>
        )}
      </div>
      {abierta && <LecturasProtocolo />}
    </div>
  );
}

function PoliticaTipo({
  tipo,
  titulo,
  bajada,
  versiones,
  children,
}: {
  tipo: PoliticaVista['tipo'];
  titulo: string;
  bajada: string;
  versiones: PoliticaVista[];
  children?: ReactNode;
}) {
  const cliente = useQueryClient();
  const vigente = versiones[0];
  const [modo, setModo] = useState<'cerrado' | 'texto' | 'editando'>('cerrado');
  const [texto, setTexto] = useState(vigente?.texto ?? '');
  const [error, setError] = useState<string>();
  const publicar = useMutation({
    mutationFn: () => datos(api.POST('/api/politicas', { body: { tipo, texto: texto.trim() } })),
    onSuccess: () => {
      setModo('cerrado');
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['configuracion', 'politicas'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos publicar la nueva versión.'),
  });
  const anteriores = versiones.length - 1;
  return (
    <li className="flex flex-col gap-2.5 rounded-[12px] border border-divider bg-bg px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-[1_1_260px] flex-col">
          <h4 className="m-0 text-[14px] font-extrabold">{titulo}</h4>
          <span className="text-[12px] font-semibold text-neutral-700">
            {vigente
              ? `Versión ${vigente.version} · desde ${formatoFecha(vigente.vigenteDesde)}${anteriores > 0 ? ` · ${anteriores} ${anteriores === 1 ? 'anterior' : 'anteriores'}` : ''}`
              : bajada}
          </span>
        </span>
        {vigente ? <Badge tono="positivo">Vigente</Badge> : <Badge tono="atencion">Sin publicar</Badge>}
        {vigente && (
          <button
            type="button"
            aria-expanded={modo === 'texto'}
            onClick={() => setModo((m) => (m === 'texto' ? 'cerrado' : 'texto'))}
            className="min-h-9 cursor-pointer rounded-full px-2.5 text-[13px] font-extrabold text-accent-700 hover:bg-accent-100"
          >
            {modo === 'texto' ? 'Ocultar texto' : 'Ver texto'}
          </button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            setTexto(vigente?.texto ?? '');
            setModo('editando');
          }}
          className="!py-2"
        >
          {vigente ? 'Nueva versión' : 'Publicar'}
        </Button>
      </div>
      {modo === 'texto' && vigente && (
        <p className="m-0 max-h-[200px] overflow-y-auto rounded-[12px] border border-divider bg-neutral-100 p-3.5 text-[13.5px] leading-relaxed whitespace-pre-line text-neutral-800">
          {vigente.texto}
        </p>
      )}
      {modo === 'editando' && (
        <div className="flex flex-col gap-3">
          <Field label="Texto de la nueva versión" hint="Mínimo 20 caracteres. Al publicar, se pedirá aceptar esta versión.">
            {(x) => <Textarea {...x} rows={8} maxLength={50000} value={texto} onChange={(e) => setTexto(e.target.value)} />}
          </Field>
          <Aviso tono="nota">La versión anterior queda guardada tal cual, con sus aceptaciones.</Aviso>
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2.5">
            <Button variant="ghost" onClick={() => setModo('cerrado')}>
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
        </div>
      )}
      {children}
    </li>
  );
}
