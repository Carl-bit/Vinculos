'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AprobarSolicitud } from '@/components/shared/AprobarSolicitud';
import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { Estadistica } from '@/components/shared/Estadistica';
import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { useExportacionesPendientes } from '@/lib/exportaciones';
import { formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { useMensajesPacientes } from '@/lib/mensajes';
import {
  hoyChile,
  inicioDiaChile,
  fechaHoyChile,
  nombreDeCita,
  nombresPacientes,
  sinSesionHaceUnMes,
  sumarDias,
  useAhora,
  useCitas,
  useDashboard,
  useEquipoAgenda,
  useEspacios,
  useEstadoFichas,
  usePacientes,
  type CitaVista,
  type ReporteDashboard,
} from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { MisRecordatorios } from './MisRecordatorios';

const diaSemana = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', weekday: 'short', day: 'numeric' });

/** Citas que cuentan como agendadas en el inicio (las demas no ocupan la hora). */
const agendada = (c: CitaVista) =>
  c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO' || c.estado === 'POR_REPROGRAMAR' || c.estado === 'SOLICITADA' || c.estado === 'PROPUESTA';

const ESTADO_SEMANA: Partial<Record<CitaVista['estado'], { texto: string; tono: TonoBadge }>> = {
  CONFIRMADA: { texto: 'Confirmada', tono: 'positivo' },
  PENDIENTE_PAGO: { texto: 'Pendiente de pago', tono: 'atencion' },
  SOLICITADA: { texto: 'Por aprobar', tono: 'atencion' },
  PROPUESTA: { texto: 'Propuesta al paciente', tono: 'atencion' },
  POR_REPROGRAMAR: { texto: 'Por reprogramar', tono: 'atencion' },
};

/**
 * Inicio del backoffice (03b-4.2), de arriba hacia abajo por prioridad:
 * 1) sesion en curso o proxima, 2) linea del dia, 3) indicadores chicos y
 * clicables, 4) "Esta semana" | "Pendientes" + "Mis recordatorios".
 * ADMIN/GESTION: el mismo orden con datos del centro y nunca contenido
 * clinico. Sin tarjetas de modulos (repetian el menu) ni calificacion (esta
 * en "Mi perfil").
 */
/**
 * `orden`: estado de "Personalizar" cuando la pagina pone sus botones en el
 * encabezado (una fila menos en notebooks). Sin el, el panel muestra los suyos.
 */
export function InicioPanel({ rol, orden: externo }: { rol: Rol; orden?: OrdenBloques }) {
  const reporte = useDashboard();
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const hoy = fechaHoyChile();
  // Hoy + 7 dias: alimenta la sesion actual, la linea del dia y "Esta semana".
  const citas = useCitas(
    {
      desde: inicioDiaChile(hoy).toISOString(),
      hasta: inicioDiaChile(sumarDias(hoy, 7)).toISOString(),
      profesionalId: admin ? (profesionalId ?? undefined) : undefined,
    },
    true,
    { sondeo: true },
  );
  const lista = [...(citas.data ?? [])].filter(agendada).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const deHoy = lista.filter((c) => c.inicio >= hoyChile().desde && c.inicio < hoyChile().hasta);

  const propio = useOrdenBloques(rol);
  const orden = externo ?? propio;
  // MVP sin finanzas: sin el modulo COBROS no se muestran pendientes de pagos, transferencias ni deudas.
  const cobros = !!useModulos().data?.activos.includes('COBROS');
  return (
    <EstadoConsulta consulta={reporte}>
      {(r) => {
        // Puntos 1, 5, 6 y 8: dos columnas. Izquierda: la sesion (u "Hoy en el centro"), indicadores compactos,
        // la linea del dia e informacion rapida. Derecha: pendientes a la altura de la sesion, y recordatorios.
        const bloques: Record<IdBloque, { titulo: string; contenido: ReactNode }> = {
          foco: { titulo: admin ? 'Hoy en el centro' : 'Próxima sesión', contenido: admin ? <AhoraCentro deHoy={deHoy} /> : <SesionFoco lista={lista} /> },
          indicadores: {
            titulo: 'Indicadores',
            contenido: (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
                {admin ? <IndicadoresCentro r={r} /> : <IndicadoresPropios r={r} />}
              </div>
            ),
          },
          linea: { titulo: 'Sesiones de hoy', contenido: <LineaDia deHoy={deHoy} admin={admin} /> },
          rapida: {
            titulo: 'Información rápida',
            contenido: <EstaSemana lista={lista.filter((c) => new Date(c.fin).getTime() > Date.now())} admin={admin} r={r} />,
          },
          pendientes: {
            titulo: 'Pendientes',
            contenido: admin ? <Pendientes items={pendientesCentro(r, rol, cobros)} /> : <PendientesPropios r={r} rol={rol} cobros={cobros} />,
          },
          recordatorios: { titulo: 'Mis recordatorios', contenido: <MisRecordatorios /> },
        };
        // Arrastrar y soltar (HTML nativo) en modo "Personalizar"; los botones quedan para teclado y pantallas tactiles.
        // Mientras se arrastra, las tarjetas se acomodan en vivo donde quedarian (vista previa); soltar lo confirma.
        const columna = (lado: Lado) => (
          <div
            className={`flex min-w-0 flex-col gap-4 ${orden.editando ? 'min-h-24 rounded-lg' : ''}`}
            onDragOver={(e) => {
              if (!orden.editando) return;
              e.preventDefault();
              orden.sobreColumna(lado);
            }}
            onDrop={(e) => {
              e.preventDefault();
              orden.soltar();
            }}
          >
            {orden.vista[lado].map((id, i) => (
              <div
                key={id}
                draggable={orden.editando}
                onDragStart={(e) => {
                  // Firefox solo inicia el arrastre con datos; sin dataTransfer (pruebas) se sigue igual.
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', id);
                  }
                  orden.tomar(id);
                }}
                onDragOver={(e) => {
                  if (!orden.editando) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // Mitad superior: antes de esta tarjeta; mitad inferior: despues.
                  const caja = e.currentTarget.getBoundingClientRect();
                  orden.sobre(lado, id, e.clientY > caja.top + caja.height / 2);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  orden.soltar();
                }}
                onDragEnd={orden.soltarFuera}
                role={orden.editando ? 'group' : undefined}
                aria-label={orden.editando ? bloques[id].titulo : undefined}
                className={
                  orden.editando
                    ? `flex cursor-grab flex-col gap-2 rounded-lg border-2 p-2.5 shadow-suave transition-[background-color,border-color,opacity] duration-200 active:cursor-grabbing ${
                        orden.arrastrando === id ? 'border-dashed border-accent-2-700 bg-accent-2-100 opacity-70' : 'border-accent-2-500 bg-bg'
                      }`
                    : ''
                }
              >
                {orden.editando && (
                  <div className="flex w-full flex-wrap items-center gap-1.5">
                    <Icon name="drag_indicator" size={18} className="text-accent-2-700" />
                    <span className="mr-auto text-[12.5px] font-extrabold text-accent-2-900">{bloques[id].titulo}</span>
                    <button
                      type="button"
                      aria-label={`Subir ${bloques[id].titulo}`}
                      disabled={i === 0}
                      onClick={() => orden.mover(lado, i, -1)}
                      className={BOTON_ORDEN}
                    >
                      <Icon name="expand_less" size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Bajar ${bloques[id].titulo}`}
                      disabled={i === orden.vista[lado].length - 1}
                      onClick={() => orden.mover(lado, i, 1)}
                      className={BOTON_ORDEN}
                    >
                      <Icon name="expand_more" size={18} />
                    </button>
                    <button type="button" onClick={() => orden.cambiarColumna(lado, i)} className={`${BOTON_ORDEN} !w-auto px-3 text-[12.5px] font-extrabold`}>
                      {lado === 'izquierda' ? 'Pasar a la derecha' : 'Pasar a la izquierda'}
                    </button>
                  </div>
                )}
                {/* Al personalizar se mantiene el tamaño real de cada tarjeta: el contenido se ve atenuado e inactivo. */}
                {orden.editando ? (
                  <div inert className="pointer-events-none opacity-45 select-none">
                    {bloques[id].contenido}
                  </div>
                ) : (
                  bloques[id].contenido
                )}
              </div>
            ))}
            {/* Grilla de fondo: casilleros libres donde se puede soltar (al final de la columna). */}
            {orden.editando &&
              Array.from({ length: Math.max(1, TOTAL_BLOQUES - orden.vista[lado].length) }, (_, k) => (
                <div
                  key={`libre-${k}`}
                  aria-hidden="true"
                  className="h-28 rounded-lg border-2 border-dashed border-neutral-300 bg-[color-mix(in_oklab,var(--color-neutral-200)_40%,transparent)]"
                />
              ))}
          </div>
        );
        return (
          <div className="flex flex-col gap-4">
            {!externo && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ControlesInicio orden={orden} />
              </div>
            )}
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              {columna('izquierda')}
              {columna('derecha')}
            </div>
          </div>
        );
      }}
    </EstadoConsulta>
  );
}

type IdBloque = 'foco' | 'indicadores' | 'linea' | 'rapida' | 'pendientes' | 'recordatorios';
type Lado = 'izquierda' | 'derecha';
const TOTAL_BLOQUES = 6;
const ORDEN_INICIAL: Record<Lado, IdBloque[]> = { izquierda: ['foco', 'indicadores', 'linea', 'rapida'], derecha: ['pendientes', 'recordatorios'] };
const BOTON_ORDEN =
  'grid size-8 cursor-pointer place-items-center rounded-full border border-divider bg-bg hover:bg-accent-2-100 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Punto 1: cada persona ordena sus bloques (subir, bajar, cambiar de columna).
 * Preferencia de quien mira: localStorage por rol (nunca datos); si el
 * almacen no esta disponible, vuelve al orden original.
 */
/** Botones de "Personalizar" el inicio (y la ayuda mientras se edita). */
export function ControlesInicio({ orden }: { orden: OrdenBloques }) {
  return (
    <>
      {orden.editando && (
        <span className="mr-auto text-[13px] font-semibold text-neutral-800">Arrastra los bloques o usa las flechas. Se guarda solo para ti.</span>
      )}
      {orden.editando && (
        <Button variant="ghost" onClick={orden.restablecer} className="!py-2 !text-[13px]">
          Volver al orden original
        </Button>
      )}
      <Button variant="secondary" icon={orden.editando ? 'check' : 'tune'} onClick={orden.alternar} className="!py-2 !text-[13px]">
        {orden.editando ? 'Listo' : 'Personalizar'}
      </Button>
    </>
  );
}

export type OrdenBloques = ReturnType<typeof useOrdenBloques>;

export function useOrdenBloques(rol: Rol) {
  const clave = `inicio:bloques:${rol}`;
  const [columnas, setColumnas] = useState<Record<Lado, IdBloque[]>>(ORDEN_INICIAL);
  const [editando, setEditando] = useState(false);
  const [arrastrando, setArrastrando] = useState<IdBloque | null>(null);
  const [previa, setPrevia] = useState<Record<Lado, IdBloque[]> | null>(null);
  // Con tarjetas de distinto alto, reacomodar mueve todo bajo el cursor: se ignoran 150 ms de eventos tras cada cambio.
  const ultimoCambio = useRef(0);
  const cambiarPrevia = (nueva: Record<Lado, IdBloque[]>) => {
    if (Date.now() - ultimoCambio.current < 150) return;
    ultimoCambio.current = Date.now();
    setPrevia(nueva);
  };
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) ?? 'null') as Record<Lado, IdBloque[]> | null;
      const todos = [...ORDEN_INICIAL.izquierda, ...ORDEN_INICIAL.derecha].sort().join();
      if (guardado && [...guardado.izquierda, ...guardado.derecha].sort().join() === todos) setColumnas(guardado);
    } catch {
      // Sin almacen: orden original.
    }
  }, [clave]);
  const guardar = (c: Record<Lado, IdBloque[]>) => {
    setColumnas(c);
    try {
      localStorage.setItem(clave, JSON.stringify(c));
    } catch {
      // Igual funciona sin recordarlo.
    }
  };
  return {
    columnas,
    editando,
    alternar: () => setEditando((e) => !e),
    restablecer: () => {
      guardar(ORDEN_INICIAL);
      try {
        localStorage.removeItem(clave);
      } catch {
        // nada
      }
    },
    mover: (lado: Lado, i: number, paso: -1 | 1) => {
      const l = [...columnas[lado]];
      [l[i], l[i + paso]] = [l[i + paso]!, l[i]!];
      guardar({ ...columnas, [lado]: l });
    },
    arrastrando,
    /** Lo que se ve: la vista previa mientras se arrastra, si no el orden guardado. */
    vista: previa ?? columnas,
    tomar: (id: IdBloque) => {
      ultimoCambio.current = 0;
      setArrastrando(id);
      setPrevia(columnas);
    },
    /** Soltar fuera (o Esc): vuelve al orden guardado. */
    soltarFuera: () => {
      setArrastrando(null);
      setPrevia(null);
    },
    /** Sobre la tarjeta `objetivo`: el arrastrado pasa antes (o despues) de ella en la vista previa. */
    sobre: (lado: Lado, objetivo: IdBloque, despues: boolean) => {
      if (!arrastrando || objetivo === arrastrando) return;
      const actual = previa ?? columnas;
      const sin = { izquierda: actual.izquierda.filter((x) => x !== arrastrando), derecha: actual.derecha.filter((x) => x !== arrastrando) };
      const destino = [...sin[lado]];
      destino.splice(destino.indexOf(objetivo) + (despues ? 1 : 0), 0, arrastrando);
      const nueva = { ...sin, [lado]: destino };
      if (JSON.stringify(nueva) !== JSON.stringify(actual)) cambiarPrevia(nueva);
    },
    /** Sobre el espacio libre de una columna: al final de esa columna (si no estaba ya ahi). */
    sobreColumna: (lado: Lado) => {
      const actual = previa ?? columnas;
      if (!arrastrando || actual[lado].includes(arrastrando)) return;
      const otro: Lado = lado === 'izquierda' ? 'derecha' : 'izquierda';
      const nueva = { [otro]: actual[otro].filter((x) => x !== arrastrando), [lado]: [...actual[lado], arrastrando] } as Record<Lado, IdBloque[]>;
      cambiarPrevia(nueva);
    },
    /** Soltar: la vista previa queda como orden guardado. */
    soltar: () => {
      if (arrastrando && previa) guardar(previa);
      setArrastrando(null);
      setPrevia(null);
    },
    cambiarColumna: (lado: Lado, i: number) => {
      const otro: Lado = lado === 'izquierda' ? 'derecha' : 'izquierda';
      const id = columnas[lado][i]!;
      guardar({ ...columnas, [lado]: columnas[lado].filter((x) => x !== id), [otro]: [...columnas[otro], id] });
    },
  };
}

/** Nombres que usa el inicio: pacientes que el rol ve, boxes y equipo. */
function useNombres() {
  const pacientes = usePacientes();
  const espacios = useEspacios();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const boxes = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const profesionales = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  return {
    paciente: (c: CitaVista) => nombreDeCita(nombres, c),
    lugar: (c: CitaVista) => (c.modalidad === 'ONLINE' ? 'Online' : c.espacioId ? (boxes.get(c.espacioId) ?? 'Box') : 'Presencial'),
    profesional: (c: CitaVista) => profesionales.get(c.profesionalId) ?? 'Profesional',
  };
}

/** 1. Profesional: sesion en curso o la proxima, con sus acciones y aviso de mensaje previo del paciente. */
function SesionFoco({ lista }: { lista: CitaVista[] }) {
  const n = useNombres();
  const mensajes = useMensajesPacientes(true);
  const ahora = Date.now();
  const actual = lista.find((c) => new Date(c.inicio).getTime() <= ahora && new Date(c.fin).getTime() > ahora);
  const foco = actual ?? lista.find((c) => new Date(c.inicio).getTime() > ahora);
  if (!foco) {
    return (
      <section className="rounded-lg border border-divider bg-bg px-6 py-5 shadow-suave">
        <EstadoVista estado="vacio" titulo="Sin sesiones en los próximos 7 días" mensaje="Cuando agendes una, aparecerá aquí con sus accesos." />
      </section>
    );
  }
  const mensaje = (mensajes.data ?? []).find((m) => m.pacienteId === foco.pacienteId && !m.leidoEn && m.creadoEn < foco.inicio);
  const esHoy = foco.inicio < hoyChile().hasta;
  return (
    <section
      aria-labelledby="sesion-foco"
      className={`rounded-lg border px-6 py-5 shadow-md ${actual ? 'border-accent-500 bg-accent-100' : 'border-divider bg-bg'}`}
    >
      <p id="sesion-foco" className="m-0 text-[11px] font-extrabold tracking-[0.12em] text-accent-800 uppercase">
        {actual ? 'Sesión en curso' : esHoy ? 'Próxima sesión' : 'Próxima sesión · ' + diaSemana.format(new Date(foco.inicio))}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
          <span className="text-[34px] leading-none font-black tracking-[-0.04em] tabular-nums">{formatoHora(foco.inicio)}</span>
          <div className="min-w-0">
            <p className="m-0 truncate text-[20px] font-black tracking-[-0.02em]">{n.paciente(foco)}</p>
            <p className="m-0 flex items-center gap-1.5 text-[13.5px] font-bold text-neutral-800">
              <Icon name={foco.modalidad === 'ONLINE' ? 'videocam' : 'meeting_room'} size={17} />
              {foco.modalidad === 'ONLINE' ? 'Online · enlace en el detalle de la sesión' : `Presencial · ${n.lugar(foco)}`}
              {foco.estado === 'PENDIENTE_PAGO' ? ' · pago pendiente' : ''}
            </p>
          </div>
        </div>
        {foco.pacienteId && (
          <div className="flex flex-wrap gap-2">
            {foco.modalidad === 'ONLINE' && (
              <ButtonLink href={`/admin/agenda?cita=${foco.id}`} variant="secondary" icon="videocam">
                Ver enlace
              </ButtonLink>
            )}
            <ButtonLink href={`/admin/fichas/${foco.pacienteId}`} variant="secondary" icon="folder_open">
              Abrir ficha
            </ButtonLink>
            <ButtonLink href={`/admin/fichas/${foco.pacienteId}?vista=evoluciones&cita=${foco.id}`} variant="team" icon="edit_note">
              Registrar evolución
            </ButtonLink>
          </div>
        )}
      </div>
      {mensaje && (
        <Link
          href="/admin/mensajes?vista=pacientes"
          className="mt-4 flex items-center gap-2 rounded-lg border border-accent-500 bg-bg px-3.5 py-2.5 text-[13.5px] font-extrabold text-text hover:text-text"
        >
          <Icon name="mail" size={18} className="text-accent-700" />
          {n.paciente(foco)} te escribió desde el portal antes de la sesión
          <Icon name="chevron_right" size={18} className="ml-auto text-neutral-700" />
        </Link>
      )}
    </section>
  );
}

/** 1. ADMIN/GESTION: lo que pasa ahora en el centro (sin datos clinicos). */
function AhoraCentro({ deHoy }: { deHoy: CitaVista[] }) {
  const n = useNombres();
  const ahora = Date.now();
  const enCurso = deHoy.filter((c) => new Date(c.inicio).getTime() <= ahora && new Date(c.fin).getTime() > ahora);
  const proximas = deHoy.filter((c) => new Date(c.inicio).getTime() > ahora).slice(0, 3);
  return (
    <section aria-labelledby="ahora-centro" className="rounded-lg border border-divider bg-bg px-6 py-5 shadow-suave">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="ahora-centro" className="m-0 text-[18px] font-black tracking-[-0.02em]">
          Hoy en el centro
        </h2>
        <span className="text-[13px] font-bold text-neutral-800">
          {deHoy.length === 1 ? '1 sesión' : `${deHoy.length} sesiones`} · {enCurso.length} en curso
        </span>
      </div>
      {enCurso.length + proximas.length === 0 ? (
        <p className="m-0 mt-2 text-[13.5px] font-semibold text-neutral-700">No quedan sesiones por hoy.</p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-2.5 p-0 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {[...enCurso, ...proximas].map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/agenda?cita=${c.id}`}
                className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-text hover:text-text ${enCurso.includes(c) ? 'border-accent-500 bg-accent-100' : 'border-divider'}`}
              >
                <span className="text-[16px] font-black tabular-nums">{formatoHora(c.inicio)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-extrabold">{n.paciente(c)}</span>
                  <span className="block truncate text-[12px] font-semibold text-neutral-700">
                    {n.profesional(c)} · {n.lugar(c)}
                    {enCurso.includes(c) ? ' · en curso' : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 2. Linea del dia: un bloque a todo el ancho con las sesiones de hoy (la
 * actual destacada). Avanza sola: las citas se sondean cada 2 minutos y el
 * reloj cada minuto. El ultimo tramo lleva a "Agenda y Espacios".
 */
function LineaDia({ deHoy, admin }: { deHoy: CitaVista[]; admin: boolean }) {
  const n = useNombres();
  const ahora = useAhora();
  return (
    <section aria-label="Sesiones de hoy" className="rounded-lg border border-divider bg-bg p-2 shadow-suave">
      <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0">
        {deHoy.length === 0 && (
          <li className="flex flex-1 items-center px-3 py-2 text-[13.5px] font-semibold text-neutral-700">Sin sesiones agendadas para hoy.</li>
        )}
        {deHoy.map((c) => {
          const actual = new Date(c.inicio).getTime() <= ahora && new Date(c.fin).getTime() > ahora;
          const pasada = new Date(c.fin).getTime() <= ahora;
          return (
            <li key={c.id} className="min-w-[150px] flex-1">
              <Link
                href={admin || !c.pacienteId ? `/admin/agenda?cita=${c.id}` : `/admin/fichas/${c.pacienteId}`}
                aria-current={actual ? 'true' : undefined}
                // 03b-6 (axe): el color del texto va en cada rama; con text-text fijo, la sesion actual quedaba en tinta sobre arcilla (2.4:1).
                className={`flex h-full flex-col rounded-md border px-3 py-2 ${
                  actual
                    ? 'border-accent-700 bg-accent-700 text-neutral-100 hover:text-neutral-100'
                    : pasada
                      ? 'border-divider bg-neutral-100 text-text hover:text-text'
                      : 'border-divider bg-bg text-text hover:border-accent-500 hover:text-text'
                }`}
              >
                <span className="text-[13px] font-black tabular-nums">
                  {formatoHora(c.inicio)}
                  {actual && <span className="ml-1.5 text-[11px] font-extrabold tracking-[0.08em] uppercase">Ahora</span>}
                </span>
                <span className={`truncate text-[12.5px] font-bold ${actual ? '' : 'text-neutral-800'}`}>{admin ? n.profesional(c) : n.paciente(c)}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-none">
          <Link
            href="/admin/agenda"
            className="flex h-full items-center gap-1.5 rounded-md border border-dashed border-accent-500 px-3.5 py-2 text-[13px] font-extrabold text-accent-800 hover:bg-accent-100 hover:text-accent-800"
          >
            <Icon name="calendar_month" size={17} />
            Agenda y Espacios
            <Icon name="chevron_right" size={17} />
          </Link>
        </li>
      </ol>
    </section>
  );
}

function IndicadoresCentro({ r }: { r: ReporteDashboard }) {
  return (
    <>
      <Estadistica
        compacta
        etiqueta="Sesiones hoy"
        valor={r.sesiones_hoy}
        nota={r.por_confirmar ? `${r.por_confirmar} por confirmar (48 h)` : 'Todo confirmado'}
        notaTono={r.por_confirmar ? 'atencion' : 'positiva'}
        href="/admin/agenda?vista=calendario"
      />
      <Estadistica
        compacta
        etiqueta="Pacientes activos"
        valor={r.pacientes_activos}
        nota={r.pacientes_nuevos_mes ? `+${r.pacientes_nuevos_mes} este mes` : 'Sin altas nuevas este mes'}
        href="/admin/fichas"
      />
      <Estadistica
        compacta
        // Punto 23: horas libres (sin apartar) en vez de un porcentaje.
        etiqueta="Horas libres en boxes hoy"
        valor={`${(r.horas_libres_boxes_hoy ?? 0).toLocaleString('es-CL')} h`}
        nota={`${r.boxes_activos ?? 0} ${r.boxes_activos === 1 ? 'box activo' : 'boxes activos'}`}
        href="/admin/agenda?vista=espacios"
      />
    </>
  );
}

/** 3. Profesional: pacientes activos, sesiones de la semana y pacientes sin sesion hace mas de un mes. */
function IndicadoresPropios({ r }: { r: ReporteDashboard }) {
  const cuenta = useMiCuenta();
  const estados = useEstadoFichas(cuenta.data?.id);
  const sinSesion = (estados.data ?? []).filter((e) => sinSesionHaceUnMes(e)).length;
  return (
    <>
      <Estadistica compacta etiqueta="Pacientes activos" valor={r.pacientes_activos} nota="Con sesión en los últimos 90 días" href="/admin/fichas" />
      <Estadistica
        compacta
        etiqueta="Sesiones esta semana"
        valor={r.sesiones_semana ?? 0}
        nota={`${r.sesiones_hoy} hoy`}
        href="/admin/agenda?vista=calendario"
      />
      <Estadistica
        compacta
        etiqueta="Sin sesión hace +1 mes"
        valor={estados.isSuccess ? sinSesion : '…'}
        nota={sinSesion ? 'Sin próxima hora ni alta' : 'Todos con seguimiento'}
        notaTono={sinSesion ? 'atencion' : 'positiva'}
        href="/admin/fichas?filtro=sin-sesion"
      />
    </>
  );
}

/** 4a. Proximas sesiones de la semana con su estado. */
function EstaSemana({ lista, admin, r }: { lista: CitaVista[]; admin: boolean; r: ReporteDashboard }) {
  const n = useNombres();
  // De a 3 (conciso); las flechas recorren las siguientes sin alargar el bloque.
  const [desde, setDesde] = useState(0);
  // MVP sin cobros: el profesional aprueba aqui las horas que pidieron sus pacientes (primero, con sus botones).
  const porAprobar = admin ? [] : lista.filter((c) => c.estado === 'SOLICITADA');
  const resto = admin ? lista : lista.filter((c) => c.estado !== 'SOLICITADA');
  return (
    <section aria-labelledby="esta-semana" className="min-w-0 rounded-lg border border-divider bg-bg px-5 pt-4 pb-5 shadow-suave">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id="esta-semana" className="m-0 text-[17px] font-black tracking-[-0.02em]">
          Información rápida
        </h2>
        <Link href="/admin/agenda" className="text-[12.5px] font-extrabold">
          Ver agenda completa
        </Link>
      </div>
      <ul className="m-0 mb-3 flex list-none flex-wrap gap-1.5 p-0">
        {[
          { n: r.sesiones_hoy, texto: 'hoy', href: '/admin/agenda?vista=calendario' },
          { n: lista.length, texto: 'en 7 días', href: '/admin/agenda' },
          { n: r.pendientes?.por_reprogramar ?? 0, texto: 'por reprogramar', href: '/admin/agenda?vista=pendientes' },
          { n: r.mensajes_sin_leer ?? 0, texto: 'mensajes sin leer', href: '/admin/mensajes?vista=pacientes' },
        ]
          .filter((d) => d.n > 0)
          .map((d) => (
            <li key={d.texto}>
              <Link
                href={d.href}
                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-neutral-200 px-3 text-[12.5px] font-extrabold text-text hover:text-text"
              >
                <span className="tabular-nums">{d.n}</span> {d.texto}
              </Link>
            </li>
          ))}
      </ul>
      {porAprobar.length > 0 && (
        <div className="mb-3 rounded-md border border-accent-300 bg-accent-100 px-3 py-2">
          <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-accent-800 uppercase">
            {plural(porAprobar.length, 'hora por aprobar', 'horas por aprobar')}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {porAprobar.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-accent-200 py-2 last:border-b-0">
                <Link href={`/admin/agenda?cita=${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-text hover:text-text">
                  <span className="w-[68px] flex-none text-[12.5px] font-extrabold text-neutral-800 first-letter:uppercase">
                    {diaSemana.format(new Date(c.inicio))}
                  </span>
                  <span className="w-[42px] flex-none text-[13px] font-black tabular-nums">{formatoHora(c.inicio)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-extrabold">{n.paciente(c)}</span>
                </Link>
                <AprobarSolicitud citaId={c.id} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {resto.length === 0 ? (
        <p className="m-0 text-[13.5px] font-semibold text-neutral-700">No hay más sesiones en los próximos 7 días.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {resto.slice(desde, desde + 3).map((c) => {
            const estado = ESTADO_SEMANA[c.estado];
            return (
              <li key={c.id} className="border-b border-divider last:border-b-0">
                <Link href={`/admin/agenda?cita=${c.id}`} className="flex min-h-11 items-center gap-3 py-2 text-text hover:text-text">
                  <span className="w-[68px] flex-none text-[12.5px] font-extrabold text-neutral-800 first-letter:uppercase">
                    {diaSemana.format(new Date(c.inicio))}
                  </span>
                  <span className="w-[42px] flex-none text-[13px] font-black tabular-nums">{formatoHora(c.inicio)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-extrabold">{n.paciente(c)}</span>
                    <span className="block truncate text-[12px] font-semibold text-neutral-700">
                      {admin ? `${n.profesional(c)} · ` : ''}
                      {n.lugar(c)}
                    </span>
                  </span>
                  {estado && <Badge tono={estado.tono}>{estado.texto}</Badge>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {resto.length > 3 && (
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <span className="mr-auto text-[12px] font-bold text-neutral-700 tabular-nums">
            {desde + 1}–{Math.min(desde + 3, resto.length)} de {resto.length}
          </span>
          <button
            type="button"
            aria-label="Sesiones anteriores"
            disabled={desde === 0}
            onClick={() => setDesde((d) => Math.max(0, d - 3))}
            className={BOTON_ORDEN}
          >
            <Icon name="chevron_left" size={18} />
          </button>
          <button
            type="button"
            aria-label="Sesiones siguientes"
            disabled={desde + 3 >= resto.length}
            onClick={() => setDesde((d) => d + 3)}
            className={BOTON_ORDEN}
          >
            <Icon name="chevron_right" size={18} />
          </button>
        </div>
      )}
    </section>
  );
}

/** 4b. Pendientes del profesional: incluye copias de datos por completar y consentimientos pendientes. */
function PendientesPropios({ r, rol, cobros }: { r: ReporteDashboard; rol: Rol; cobros: boolean }) {
  const exportaciones = useExportacionesPendientes(rol === 'PROFESIONAL');
  const consentimientos = r.pendientes?.consentimientos_pendientes ?? 0;
  return (
    <Pendientes
      items={[
        ...((exportaciones.data?.length ?? 0) > 0
          ? [
              {
                icono: 'description' as Icono,
                titulo: plural(exportaciones.data!.length, 'copia de datos por completar', 'copias de datos por completar'),
                meta: 'Un paciente pidió sus datos: falta la parte clínica',
                href: `/admin/fichas/${exportaciones.data![0].pacienteId}?vista=documentos`,
                tono: 'atencion' as const,
              },
            ]
          : []),
        ...pendientesPropios(r, cobros),
        ...(consentimientos > 0
          ? [
              {
                icono: 'verified_user' as Icono,
                titulo: plural(consentimientos, 'consentimiento pendiente', 'consentimientos pendientes'),
                meta: 'Atención con practicante supervisado',
                href: '/admin/fichas?vista=practicas',
                tono: 'neutra' as const,
              },
            ]
          : []),
      ]}
    />
  );
}

interface Pendiente {
  icono: Icono;
  titulo: string;
  meta: string;
  href: string;
  tono: 'atencion' | 'neutra';
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function pendientesCentro(r: ReporteDashboard, rol: Rol, cobros: boolean): Pendiente[] {
  const p = r.pendientes;
  if (!p) return [];
  const lista: (Pendiente | false)[] = [
    cobros &&
      p.transferencias_por_validar > 0 && {
        icono: 'payments',
        titulo: plural(p.transferencias_por_validar, 'transferencia por validar', 'transferencias por validar'),
        meta: 'Al validarla, la hora queda confirmada',
        href: '/admin/cobros?vista=transferencias',
        tono: 'atencion',
      },
    cobros &&
      p.pagos_pendientes > 0 && {
        icono: 'schedule',
        titulo: plural(p.pagos_pendientes, 'hora con pago pendiente', 'horas con pago pendiente'),
        meta: 'Se confirman con el pago; si vence el plazo, se pagan en el centro',
        href: '/admin/agenda?vista=pendientes',
        tono: 'neutra',
      },
    cobros &&
      p.pacientes_con_deuda > 0 && {
        icono: 'payments',
        titulo: plural(p.pacientes_con_deuda, 'paciente con deuda', 'pacientes con deuda'),
        meta: 'Sesiones realizadas sin pagar: no agendan hasta regularizar',
        href: '/admin/cobros?vista=deudas',
        tono: 'atencion',
      },
    (r.fichas_por_cerrar ?? 0) > 0 && {
      icono: 'edit_note',
      titulo: plural(r.fichas_por_cerrar!, 'ficha por cerrar', 'fichas por cerrar'),
      meta: 'Sesiones de 7 días sin evolución: el detalle por profesional está en Seguimiento',
      href: '/admin/fichas',
      tono: 'atencion',
    },
    p.por_reprogramar > 0 && {
      icono: 'event_repeat',
      titulo: plural(p.por_reprogramar, 'cita por reprogramar', 'citas por reprogramar'),
      meta: 'Bajas, consentimientos retirados o bloqueos',
      href: '/admin/agenda?vista=pendientes',
      tono: 'atencion',
    },
    p.ruts_faltantes > 0 && {
      icono: 'badge',
      titulo: plural(p.ruts_faltantes, 'paciente sin RUT', 'pacientes sin RUT'),
      meta: 'Llegaron por la web: registrar en recepción',
      href: '/admin/fichas?filtro=sin-rut',
      tono: 'atencion',
    },
    p.posibles_duplicados > 0 && {
      icono: 'person_search',
      titulo: plural(p.posibles_duplicados, 'posible duplicado', 'posibles duplicados'),
      meta: 'Revisar y conciliar',
      href: '/admin/fichas?filtro=duplicados',
      tono: 'atencion',
    },
    p.consentimientos_pendientes > 0 && {
      icono: 'verified_user',
      titulo: plural(p.consentimientos_pendientes, 'consentimiento pendiente', 'consentimientos pendientes'),
      meta: 'Atención con practicante supervisado',
      href: '/admin/fichas?vista=practicas',
      tono: 'neutra',
    },
    p.practicantes_por_vencer > 0 && {
      icono: 'hourglass_top',
      titulo: plural(p.practicantes_por_vencer, 'practicante por vencer', 'practicantes por vencer'),
      meta: 'Acceso termina en menos de 14 días',
      href: '/admin/equipo?vista=practicantes',
      tono: 'neutra',
    },
    rol === 'ADMIN' &&
      (p.resenas_por_moderar ?? 0) > 0 && {
        icono: 'reviews',
        titulo: plural(p.resenas_por_moderar!, 'reseña por moderar', 'reseñas por moderar'),
        meta: 'Antes de publicarse en el perfil',
        href: '/admin/equipo?vista=resenas',
        tono: 'neutra',
      },
    rol === 'ADMIN' &&
      (p.alertas_abiertas ?? 0) > 0 && {
        icono: 'warning',
        titulo: plural(p.alertas_abiertas!, 'alerta interna', 'alertas internas'),
        meta: 'Bajas con borradores, duplicados y otras',
        href: '/admin/equipo?vista=alertas',
        tono: 'atencion',
      },
  ];
  return lista.filter((x): x is Pendiente => !!x);
}

function pendientesPropios(r: ReporteDashboard, cobros: boolean): Pendiente[] {
  const lista: (Pendiente | false)[] = [
    (r.fichas_sin_cerrar ?? 0) > 0 && {
      icono: 'edit_note',
      titulo: plural(r.fichas_sin_cerrar!, 'sesión sin evolución', 'sesiones sin evolución'),
      meta: 'Últimos 30 días',
      href: '/admin/fichas?filtro=sin-cerrar',
      tono: 'atencion',
    },
    (r.borradores ?? 0) > 0 && {
      icono: 'draft',
      titulo: plural(r.borradores!, 'borrador sin confirmar', 'borradores sin confirmar'),
      meta: 'Confírmalos en el expediente',
      href: '/admin/fichas?vista=borradores',
      tono: 'atencion',
    },
    cobros &&
      (r.pagos_pendientes ?? 0) > 0 && {
        icono: 'schedule',
        titulo: plural(r.pagos_pendientes!, 'hora con pago pendiente', 'horas con pago pendiente'),
        meta: 'Se confirman con el pago del paciente',
        href: '/admin/agenda?vista=pendientes',
        tono: 'neutra',
      },
    cobros &&
      (r.pacientes_con_deuda ?? 0) > 0 && {
        icono: 'payments',
        titulo: plural(r.pacientes_con_deuda!, 'paciente con deuda', 'pacientes con deuda'),
        meta: 'Sesiones realizadas sin pagar: no agendan hasta regularizar',
        href: '/admin/cobros?vista=deudas',
        tono: 'atencion',
      },
    (r.mensajes_sin_leer ?? 0) > 0 && {
      icono: 'mail',
      titulo: plural(r.mensajes_sin_leer!, 'mensaje sin leer', 'mensajes sin leer'),
      meta: 'Escritos por tus pacientes desde el portal',
      href: '/admin/mensajes?vista=pacientes',
      tono: 'neutra',
    },
  ];
  return lista.filter((x): x is Pendiente => !!x);
}

function Pendientes({ items }: { items: Pendiente[] }): ReactNode {
  return (
    <section className="rounded-lg border border-divider bg-bg px-[22px] pt-5 pb-[22px] shadow-suave">
      <h2 className="m-0 mb-4 text-[18px] font-black tracking-[-0.02em]">Pendientes</h2>
      {items.length === 0 ? (
        <EstadoVista estado="vacio" titulo="Nada pendiente" mensaje="Cuando haya algo que revisar, aparecerá aquí." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((t) => (
            <li key={t.titulo} className="border-b border-divider pb-3 last:border-b-0">
              <Link href={t.href} className="group flex items-start gap-3 text-text hover:text-text">
                <Icon name={t.icono} size={19} className={t.tono === 'atencion' ? 'text-accent-700' : 'text-accent-2-700'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-[1.35] font-extrabold tracking-[-0.01em] text-pretty group-hover:underline">{t.titulo}</span>
                  <span className="block text-[12.5px] font-semibold text-neutral-700">{t.meta}</span>
                </span>
                <Icon name="chevron_right" size={18} className="text-neutral-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
