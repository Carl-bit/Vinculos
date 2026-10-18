'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { Estadistica } from '@/components/shared/Estadistica';
import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { TarjetaModulo } from '@/components/shared/TarjetaModulo';
import { Icon } from '@/components/ui/Icon';
import { useProfesionales } from '@/lib/consultas';
import { formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { MENU, type ModuloCentro } from '@/lib/navegacion';
import { hoyChile, nombresPacientes, useCitas, useDashboard, useEspacios, usePacientes, type ReporteDashboard } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

const MODULOS: { id: ModuloCentro; nombre: string; descripcion: string; icono: Icono; href: string }[] = [
  {
    id: 'FICHAS',
    nombre: 'Fichas y Pacientes',
    descripcion: 'Pacientes, fichas clínicas, evoluciones y documentos.',
    icono: 'folder_shared',
    href: '/admin/fichas',
  },
  { id: 'AGENDA', nombre: 'Agenda y Espacios', descripcion: 'Citas, boxes y horas apartadas del equipo.', icono: 'calendar_month', href: '/admin/agenda' },
  { id: 'EQUIPO', nombre: 'Equipo', descripcion: 'Perfiles, practicantes, supervisión y accesos.', icono: 'groups', href: '/admin/equipo' },
  { id: 'MATCH', nombre: 'Match Terapéutico', descripcion: 'Cuestionario público y recomendación explicada.', icono: 'join', href: '/admin/match' },
  { id: 'COBROS', nombre: 'Cobros', descripcion: 'Pagos, boletas y liquidaciones del equipo.', icono: 'payments', href: '/admin/cobros' },
  { id: 'PAGINA_PUBLICA', nombre: 'Página pública', descripcion: 'Landing, equipo y reseñas del centro.', icono: 'public', href: '/' },
];

/**
 * Inicio del backoffice (diseño "Admin - Dashboard"): indicadores del rol
 * activo, modulos del centro, sesiones de hoy y pendientes. ADMIN/GESTION ven
 * agregados sin datos clinicos; el profesional, lo suyo.
 */
export function InicioPanel({ rol }: { rol: Rol }) {
  const reporte = useDashboard();
  const admin = esAdministracion(rol);
  return (
    <EstadoConsulta consulta={reporte}>
      {(r) => (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {admin ? <IndicadoresCentro r={r} /> : <IndicadoresPropios r={r} />}
          </div>
          <ModulosCentro rol={rol} activos={r.modulos} />
          <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
            <SesionesHoy rol={rol} />
            <Pendientes items={admin ? pendientesCentro(r, rol) : pendientesPropios(r)} />
          </div>
        </div>
      )}
    </EstadoConsulta>
  );
}

function IndicadoresCentro({ r }: { r: ReporteDashboard }) {
  return (
    <>
      <Estadistica
        etiqueta="Pacientes activos"
        valor={r.pacientes_activos}
        nota={r.pacientes_nuevos_mes ? `+${r.pacientes_nuevos_mes} este mes` : 'Sin altas nuevas este mes'}
        notaTono={r.pacientes_nuevos_mes ? 'positiva' : 'neutra'}
        href="/admin/fichas"
      />
      <Estadistica
        etiqueta="Sesiones hoy"
        valor={r.sesiones_hoy}
        nota={r.por_confirmar ? `${r.por_confirmar} por confirmar (48 h)` : 'Todo confirmado'}
        notaTono={r.por_confirmar ? 'atencion' : 'positiva'}
        href="/admin/agenda"
      />
      <Estadistica
        etiqueta="Uso de boxes hoy"
        valor={`${r.ocupacion_boxes_hoy ?? 0}%`}
        nota={`${r.boxes_activos ?? 0} ${r.boxes_activos === 1 ? 'box activo' : 'boxes activos'} · horas apartadas`}
        href="/admin/agenda?vista=espacios"
      />
      <Estadistica
        etiqueta="Fichas por cerrar"
        valor={r.fichas_por_cerrar ?? 0}
        nota={r.fichas_por_cerrar ? 'Sesiones de los últimos 7 días sin evolución' : 'Al día'}
        notaTono={r.fichas_por_cerrar ? 'atencion' : 'positiva'}
      />
    </>
  );
}

function IndicadoresPropios({ r }: { r: ReporteDashboard }) {
  return (
    <>
      <Estadistica etiqueta="Sesiones hoy" valor={r.sesiones_hoy} nota={`${r.sesiones_semana ?? 0} esta semana`} href="/admin/agenda" />
      <Estadistica etiqueta="Pacientes activos" valor={r.pacientes_activos} nota="Con sesión en los últimos 90 días" href="/admin/fichas" />
      <Estadistica
        etiqueta="Fichas sin cerrar"
        valor={r.fichas_sin_cerrar ?? 0}
        nota={
          r.borradores
            ? `${r.borradores} ${r.borradores === 1 ? 'borrador' : 'borradores'} sin confirmar`
            : r.fichas_sin_cerrar
              ? 'Sesiones realizadas sin evolución'
              : 'Al día'
        }
        notaTono={r.fichas_sin_cerrar || r.borradores ? 'atencion' : 'positiva'}
        href="/admin/fichas?filtro=sin-cerrar"
      />
      <Estadistica
        etiqueta="Calificación"
        valor={r.calificacion != null ? r.calificacion.toLocaleString('es-CL', { minimumFractionDigits: 1 }) : '—'}
        nota={r.resenas ? `${r.resenas} ${r.resenas === 1 ? 'reseña publicada' : 'reseñas publicadas'}` : 'Sin reseñas publicadas'}
        href="/admin/perfil#resenas"
      />
    </>
  );
}

function ModulosCentro({ rol, activos }: { rol: Rol; activos: ModuloCentro[] }) {
  // Mismos roles que el menu. Los no contratados solo los ve ADMIN (informativo: los activa el operador del producto).
  const delRol = new Set(MENU.admin.filter((i) => i.modulo && i.roles.includes(rol)).map((i) => i.modulo));
  const visibles = MODULOS.filter((m) => delRol.has(m.id) && (activos.includes(m.id) || rol === 'ADMIN'));
  return (
    <section>
      <div className="mb-3.5 flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-[19px] font-black tracking-[-0.025em]">Módulos del centro</h2>
        {rol === 'ADMIN' && (
          <Link href="/admin/configuracion#modulos" className="text-[12.5px] font-extrabold">
            Ver módulos contratados
          </Link>
        )}
      </div>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))]">
        {visibles.map((m) => (
          <TarjetaModulo
            key={m.id}
            nombre={m.nombre}
            descripcion={m.descripcion}
            icono={m.icono}
            href={m.href}
            activo={activos.includes(m.id)}
            meta={activos.includes(m.id) ? 'Activo' : 'No contratado'}
          />
        ))}
      </div>
    </section>
  );
}

function SesionesHoy({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const hoy = hoyChile();
  const citas = useCitas({ ...hoy, profesionalId: admin ? (profesionalId ?? undefined) : undefined });
  const pacientes = usePacientes();
  const espacios = useEspacios();
  const profesionales = useProfesionales(admin);
  const nombres = nombresPacientes(pacientes.data);
  const boxes = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const equipo = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const lista = (citas.data ?? []).filter((c) => c.estado === 'CONFIRMADA' || c.estado === 'SOLICITADA');

  return (
    <section className="rounded-lg border border-divider bg-bg px-[22px] pt-5 pb-[22px] shadow-md">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-[18px] font-black tracking-[-0.02em]">{admin ? 'Sesiones de hoy' : 'Tus sesiones de hoy'}</h2>
        <Link href="/admin/agenda" className="text-[12.5px] font-extrabold">
          Ver agenda
        </Link>
      </div>
      <EstadoConsulta consulta={citas} vacio={() => lista.length === 0} textoVacio="No hay sesiones agendadas para hoy">
        {() => (
          <ul className="m-0 flex list-none flex-col p-0">
            {lista.map((c) => (
              <li key={c.id} className="flex items-center gap-4 border-b border-divider py-[13px] last:border-b-0">
                <span className="w-[46px] flex-none text-[14px] font-black tracking-[-0.02em] tabular-nums">{formatoHora(c.inicio)}</span>
                <span
                  aria-hidden="true"
                  className={`h-[30px] w-[3px] flex-none rounded-full ${c.modalidad === 'ONLINE' ? 'bg-accent-2-600' : 'bg-accent-600'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[14.5px] font-extrabold tracking-[-0.01em]">{nombres.get(c.pacienteId) ?? 'Paciente'}</p>
                  <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                    {c.modalidad === 'ONLINE' ? 'Online' : 'Presencial'}
                    {admin ? ` · ${equipo.get(c.profesionalId) ?? 'Profesional'}` : ''}
                    {c.estado === 'SOLICITADA' ? ' · por aprobar' : ''}
                  </p>
                </div>
                {c.espacioId && (
                  <span className="flex-none rounded-full border border-divider px-[11px] py-1 text-xs font-extrabold text-neutral-700">
                    {boxes.get(c.espacioId) ?? 'Box'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
    </section>
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
    p.solicitudes_por_aprobar > 0 && {
      icono: 'how_to_reg',
      titulo: plural(p.solicitudes_por_aprobar, 'hora por aprobar', 'horas por aprobar'),
      meta: 'Pacientes nuevos de profesionales que aprueban',
      href: '/admin/agenda?vista=pendientes',
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
      href: '/admin/fichas?filtro=consentimientos',
      tono: 'neutra',
    },
    p.practicantes_por_vencer > 0 && {
      icono: 'hourglass_top',
      titulo: plural(p.practicantes_por_vencer, 'practicante por vencer', 'practicantes por vencer'),
      meta: 'Acceso termina en menos de 14 días',
      href: '/admin/equipo?vista=practicantes',
      tono: 'neutra',
    },
    p.lista_espera > 0 && {
      icono: 'hourglass_empty',
      titulo: plural(p.lista_espera, 'persona en lista de espera', 'personas en lista de espera'),
      meta: 'Ofrecer las horas que se liberen',
      href: '/admin/agenda?vista=lista-espera',
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
      href: '/admin/fichas?filtro=borradores',
      tono: 'atencion',
    },
    (r.solicitudes_por_aprobar ?? 0) > 0 && {
      icono: 'how_to_reg',
      titulo: plural(r.solicitudes_por_aprobar!, 'hora por aprobar', 'horas por aprobar'),
      meta: 'Pacientes nuevos',
      href: '/admin/agenda?vista=pendientes',
      tono: 'atencion',
    },
    (r.mensajes_sin_leer ?? 0) > 0 && {
      icono: 'mail',
      titulo: plural(r.mensajes_sin_leer!, 'mensaje sin leer', 'mensajes sin leer'),
      meta: 'Escritos por tus pacientes desde el portal',
      href: '/admin/fichas?vista=mensajes',
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
