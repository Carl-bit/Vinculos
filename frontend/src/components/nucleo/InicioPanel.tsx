'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { Estadistica } from '@/components/shared/Estadistica';
import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { useMiCuenta } from '@/lib/consultas';
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
const agendada = (c: CitaVista) => c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO' || c.estado === 'POR_REPROGRAMAR';

const ESTADO_SEMANA: Partial<Record<CitaVista['estado'], { texto: string; tono: TonoBadge }>> = {
  CONFIRMADA: { texto: 'Confirmada', tono: 'positivo' },
  PENDIENTE_PAGO: { texto: 'Pendiente de pago', tono: 'atencion' },
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
export function InicioPanel({ rol }: { rol: Rol }) {
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

  return (
    <EstadoConsulta consulta={reporte}>
      {(r) => (
        <div className="flex flex-col gap-4">
          {admin ? <AhoraCentro deHoy={deHoy} /> : <SesionFoco lista={lista} />}
          <LineaDia deHoy={deHoy} admin={admin} />
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            {admin ? <IndicadoresCentro r={r} /> : <IndicadoresPropios r={r} />}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <EstaSemana lista={lista.filter((c) => new Date(c.fin).getTime() > Date.now())} admin={admin} />
            <div className="flex min-w-0 flex-col gap-4">
              {admin ? <Pendientes items={pendientesCentro(r, rol)} /> : <PendientesPropios r={r} rol={rol} />}
              <MisRecordatorios />
            </div>
          </div>
        </div>
      )}
    </EstadoConsulta>
  );
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
      <section className="rounded-lg border border-divider bg-bg px-6 py-5 shadow-md">
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
    <section aria-labelledby="ahora-centro" className="rounded-lg border border-divider bg-bg px-6 py-5 shadow-md">
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
    <section aria-label="Sesiones de hoy" className="rounded-lg border border-divider bg-bg p-2 shadow-md">
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
                className={`flex h-full flex-col rounded-md border px-3 py-2 text-text hover:text-text ${
                  actual
                    ? 'border-accent-700 bg-accent-700 text-neutral-100 hover:text-neutral-100'
                    : pasada
                      ? 'border-divider bg-neutral-100'
                      : 'border-divider bg-bg hover:border-accent-500'
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
        etiqueta="Uso de boxes hoy"
        valor={`${r.ocupacion_boxes_hoy ?? 0}%`}
        nota={`${r.boxes_activos ?? 0} ${r.boxes_activos === 1 ? 'box activo' : 'boxes activos'}`}
        href="/admin/agenda?vista=espacios"
      />
      <Estadistica
        compacta
        etiqueta="Fichas por cerrar"
        valor={r.fichas_por_cerrar ?? 0}
        nota={r.fichas_por_cerrar ? 'Sesiones de 7 días sin evolución' : 'Al día'}
        notaTono={r.fichas_por_cerrar ? 'atencion' : 'positiva'}
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
function EstaSemana({ lista, admin }: { lista: CitaVista[]; admin: boolean }) {
  const n = useNombres();
  return (
    <section aria-labelledby="esta-semana" className="rounded-lg border border-divider bg-bg px-5 pt-4 pb-5 shadow-md">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id="esta-semana" className="m-0 text-[17px] font-black tracking-[-0.02em]">
          Esta semana
        </h2>
        <Link href="/admin/agenda" className="text-[12.5px] font-extrabold">
          Ver agenda
        </Link>
      </div>
      {lista.length === 0 ? (
        <p className="m-0 text-[13.5px] font-semibold text-neutral-700">No hay sesiones en los próximos 7 días.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {lista.slice(0, 12).map((c) => {
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
    </section>
  );
}

/** 4b. Pendientes del profesional: incluye copias de datos por completar y consentimientos pendientes. */
function PendientesPropios({ r, rol }: { r: ReporteDashboard; rol: Rol }) {
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
        ...pendientesPropios(r),
        ...(consentimientos > 0
          ? [
              {
                icono: 'verified_user' as Icono,
                titulo: plural(consentimientos, 'consentimiento pendiente', 'consentimientos pendientes'),
                meta: 'Atención con practicante supervisado',
                href: '/admin/fichas?vista=consentimientos',
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

function pendientesCentro(r: ReporteDashboard, rol: Rol): Pendiente[] {
  const p = r.pendientes;
  if (!p) return [];
  const lista: (Pendiente | false)[] = [
    p.transferencias_por_validar > 0 && {
      icono: 'payments',
      titulo: plural(p.transferencias_por_validar, 'transferencia por validar', 'transferencias por validar'),
      meta: 'Al validarla, la hora queda confirmada',
      href: '/admin/cobros?vista=transferencias',
      tono: 'atencion',
    },
    p.pagos_pendientes > 0 && {
      icono: 'schedule',
      titulo: plural(p.pagos_pendientes, 'hora con pago pendiente', 'horas con pago pendiente'),
      meta: 'Se confirman con el pago; si vence el plazo, se pagan en el centro',
      href: '/admin/agenda?vista=pendientes',
      tono: 'neutra',
    },
    p.pacientes_con_deuda > 0 && {
      icono: 'payments',
      titulo: plural(p.pacientes_con_deuda, 'paciente con deuda', 'pacientes con deuda'),
      meta: 'Sesiones realizadas sin pagar: no agendan hasta regularizar',
      href: '/admin/cobros?vista=deudas',
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
      href: '/admin/fichas?vista=consentimientos',
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

function pendientesPropios(r: ReporteDashboard): Pendiente[] {
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
    (r.pagos_pendientes ?? 0) > 0 && {
      icono: 'schedule',
      titulo: plural(r.pagos_pendientes!, 'hora con pago pendiente', 'horas con pago pendiente'),
      meta: 'Se confirman con el pago del paciente',
      href: '/admin/agenda?vista=pendientes',
      tono: 'neutra',
    },
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
    <section className="rounded-lg border border-divider bg-bg px-[22px] pt-5 pb-[22px] shadow-md">
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
