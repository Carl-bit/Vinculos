'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Encabezado } from '@/components/shared/Encabezado';
import { api, datos } from '@/lib/api/cliente';
import { useConfiguracionCentro, useContenidoPublico, useDirectorioEquipo, useHorarioCentro, useLecturasProtocolo, usePoliticas } from '@/lib/centro';

import { AuditoriaAccesos } from './AuditoriaAccesos';
import { ContratoCentroPanel } from './ContratoCentro';
import { DatosCentro } from './DatosCentro';
import { ExportacionCentro } from './ExportacionCentro';
import { FeriadosCentro } from './FeriadosCentro';
import { AvisoSinHorario, HorarioCentroEditor, PoliticasCentro } from './HorarioPoliticasCentro';
import { MediosPagoCentro } from './MediosPagoCentro';
import { PlantillasMensaje } from './PlantillasMensaje';
import { MODULOS, ReglasCentro } from './ReglasCentro';
import { SolicitudesDerechos } from './SolicitudesDerechos';
import { SoporteCentro } from './SoporteCentro';

type Seccion = 'datos' | 'horario' | 'agenda' | 'cobros' | 'medios' | 'avisos' | 'equipo' | 'legal' | 'privacidad' | 'vinculos';
type Tono = 'atencion' | 'positivo' | 'neutro';

/** Diseño "Opcion A submenu agrupado por tema": secciones por tema, con titulo, bajada y palabras para el buscador. */
const SECCIONES: Record<Seccion, { nombre: string; bajada: string; claves: string }> = {
  datos: {
    nombre: 'Datos y página pública',
    bajada: 'Lo que se edita acá aparece en correos, comprobantes y la página pública.',
    claves: 'nombre rut correo teléfono dirección whatsapp instagram logo portada misión visión servicios color marca contacto',
  },
  horario: {
    nombre: 'Horario y feriados',
    bajada: 'El marco dentro del que caen todas las citas y los horarios de box.',
    claves: 'horario atención apertura cierre días feriado feriados',
  },
  agenda: {
    nombre: 'Agenda y plazos',
    bajada: 'Reservas, recordatorios y plazos de derivaciones, consentimientos y evoluciones.',
    claves: 'recordatorio margen retención derivación consentimiento oposición evolución edad mínima mensajes conservación plazo',
  },
  cobros: {
    nombre: 'Cobros y acuerdos',
    bajada: 'Quién cobra cada atención y qué se deben el centro y cada profesional.',
    claves: 'cobro comisión acuerdo cuota box arriendo cancelación inasistencia cargo deuda moroso gracia liquidación pago previo boleta retención iva',
  },
  medios: {
    nombre: 'Medios de pago',
    bajada: 'Cómo paga el paciente y con qué cuenta se conecta cada cobro.',
    claves: 'medios pago transferencia cuenta banco titular plazo porcentaje pasarela link conexión',
  },
  avisos: {
    nombre: 'Avisos al paciente y equipo',
    bajada: 'Una fila por aviso, una columna por destino. Lo que va entre llaves lo completa el sistema.',
    claves: 'avisos notificaciones plantillas mensaje correo bandeja recordatorio',
  },
  equipo: {
    nombre: 'Roles y accesos',
    bajada: 'La política general. El rol de cada persona se asigna en Equipo.',
    claves: 'roles accesos gestión cuenta madre profesional practicante jerarquía',
  },
  legal: {
    nombre: 'Consentimientos y políticas',
    bajada: 'Cada versión nueva queda registrada con quién la aceptó y cuándo.',
    claves: 'consentimiento política datos términos agendamiento protocolo practicante reglas',
  },
  privacidad: {
    nombre: 'Datos personales y auditoría',
    bajada: 'Derechos de los titulares (Ley 21.719), registro de accesos y exportación.',
    claves: 'auditoría accesos solicitudes derechos titulares exportar exportación ley 21.719',
  },
  vinculos: {
    nombre: 'Módulos, contrato y soporte',
    bajada: 'Tu relación con Vinculos: lo contratado, lo aceptado y lo autorizado.',
    claves: 'módulos contrato términos dpa soporte whatsapp',
  },
};

const GRUPOS: { titulo: string; secciones: Seccion[] }[] = [
  { titulo: 'El centro', secciones: ['datos', 'horario'] },
  { titulo: 'Operación', secciones: ['agenda'] },
  { titulo: 'Finanzas', secciones: ['cobros', 'medios'] },
  { titulo: 'Comunicación', secciones: ['avisos'] },
  { titulo: 'Equipo', secciones: ['equipo'] },
  { titulo: 'Legal y privacidad', secciones: ['legal', 'privacidad'] },
  { titulo: 'Vinculos', secciones: ['vinculos'] },
];

/** Enlaces anteriores (?vista=) a la seccion que hoy los contiene. */
const ALIAS: Record<string, Seccion> = {
  modulos: 'vinculos',
  soporte: 'vinculos',
  politicas: 'legal',
  notificaciones: 'avisos',
  reglas: 'cobros',
  roles: 'equipo',
  auditoria: 'privacidad',
  derechos: 'privacidad',
  exportacion: 'privacidad',
  feriados: 'horario',
};

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const CHIP: Record<Tono, string> = {
  atencion: 'bg-pendiente-100 text-pendiente-900',
  positivo: 'bg-accent-2-200 text-accent-2-800',
  neutro: 'bg-neutral-200 text-neutral-800',
};

/** Contadores del submenu, con datos que la vista ya pide (comparten cache con cada seccion). */
function useChips(): Partial<Record<Seccion, { texto: string; tono: Tono }>> {
  const c = useConfiguracionCentro().data;
  const p = useContenidoPublico().data;
  const horario = useHorarioCentro().data;
  const plantillas = useQuery({ queryKey: ['configuracion', 'plantillas'], queryFn: () => datos(api.GET('/api/plantillas-mensaje')) }).data;
  const hayProtocolo = usePoliticas().data?.some((x) => x.tipo === 'PROTOCOLO_EQUIPO') ?? false;
  const lecturas = useLecturasProtocolo(hayProtocolo).data;
  const equipo = useDirectorioEquipo(true).data;
  const acuerdos = useQuery({ queryKey: ['cobros', 'acuerdos'], queryFn: () => datos(api.GET('/api/cobros/acuerdos')) }).data;
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const sinAcuerdo =
    acuerdos && equipo
      ? equipo.filter((m) => m.roles.includes('PROFESIONAL') && !acuerdos.some((a) => a.profesionalId === m.id && a.vigenteDesde.slice(0, 10) <= hoy)).length
      : 0;
  // Mismo conteo que LecturasProtocolo: integrantes del equipo sin lectura de la version vigente.
  const leidos = new Set(lecturas?.map((l) => l.usuarioId));
  const sinLeer =
    hayProtocolo && lecturas && equipo ? equipo.filter((m) => m.roles.some((r) => r !== 'PACIENTE' && r !== 'RESPONSABLE') && !leidos.has(m.id)).length : 0;
  return {
    datos: p && (!p.mision?.trim() || !p.vision?.trim()) ? { texto: !p.mision?.trim() ? 'Misión vacía' : 'Visión vacía', tono: 'atencion' } : undefined,
    horario: horario && horario.length === 0 ? { texto: 'Sin horario', tono: 'atencion' } : undefined,
    cobros: sinAcuerdo ? { texto: `${sinAcuerdo} sin acuerdo`, tono: 'atencion' } : undefined,
    medios: c ? { texto: `${c.mediosPagoHabilitados.length} ${c.mediosPagoHabilitados.length === 1 ? 'activo' : 'activos'}`, tono: 'positivo' } : undefined,
    avisos: plantillas ? { texto: String(plantillas.length), tono: 'neutro' } : undefined,
    legal: sinLeer ? { texto: `${sinLeer} sin leer`, tono: 'atencion' } : undefined,
    vinculos: c ? { texto: `${c.modulosActivos.length} de ${MODULOS.length}`, tono: 'neutro' } : undefined,
  };
}

/**
 * Configuracion del centro (diseño "Opcion A submenu agrupado por tema", solo
 * ADMIN): submenu lateral por tema con buscador y contadores; cada seccion
 * reune los bloques de un mismo tema. Las conexiones de pasarela, "Solicitar"
 * un modulo y "Recordar a pendientes" son diseño de ejemplo, sin endpoint
 * (ver docs/front/inventario_ui.md). Los acuerdos por profesional son del
 * modulo Cobros: la pagina los pasa como `acuerdosProfesionales`.
 */
export function ConfiguracionCentro({ acuerdosProfesionales }: { acuerdosProfesionales?: ReactNode } = {}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const pedida = parametros.get('vista') ?? 'datos';
  const seccion: Seccion = pedida in SECCIONES ? (pedida as Seccion) : (ALIAS[pedida] ?? 'datos');
  const [busqueda, setBusqueda] = useState('');
  const chips = useChips();
  const filtro = normalizar(busqueda.trim());
  const coincide = (s: Seccion) => !filtro || normalizar(`${SECCIONES[s].nombre} ${SECCIONES[s].claves}`).includes(filtro);
  const grupos = GRUPOS.map((g) => ({ ...g, secciones: g.secciones.filter(coincide) })).filter((g) => g.secciones.length);
  const ir = (s: Seccion) => router.replace(s === 'datos' ? '/admin/configuracion' : `/admin/configuracion?vista=${s}`, { scroll: false });
  const actual = SECCIONES[seccion];

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <Encabezado
            tono="team"
            sobretitulo="Centro"
            titulo="Configuración del centro"
            bajada="Datos, reglas y políticas que usan todos los módulos y la página pública."
          />
        </div>
        <label className="mb-[22px] flex w-full flex-col gap-1 sm:w-[300px]">
          <span className="text-[12px] font-extrabold">Buscar un ajuste</span>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Ej.: comisión, recordatorio, feriado"
            className="min-h-11 rounded-full border border-neutral-400 bg-neutral-100 px-4 text-[14px] text-text placeholder:text-neutral-600"
          />
        </label>
      </div>
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <nav
          aria-label="Secciones de configuración"
          className="flex w-full flex-none flex-col gap-0.5 rounded-[18px] border border-divider bg-surface px-2.5 py-3.5 lg:sticky lg:top-4 lg:w-[260px]"
        >
          {grupos.map((g) => (
            <div key={g.titulo} className="flex flex-col gap-0.5">
              <p className="m-0 px-2.5 pt-3 pb-1 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{g.titulo}</p>
              {g.secciones.map((s) => {
                const activa = s === seccion;
                const chip = chips[s];
                return (
                  <button
                    key={s}
                    type="button"
                    aria-current={activa ? 'page' : undefined}
                    onClick={() => ir(s)}
                    className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[10px] pr-2.5 pl-3 text-left text-[14px] transition-colors duration-200 ease-out ${
                      activa ? 'bg-accent-2-200 font-extrabold text-accent-2-900' : 'font-semibold text-text hover:bg-neutral-200'
                    }`}
                  >
                    <span className="flex-1">{SECCIONES[s].nombre}</span>
                    {chip && <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold whitespace-nowrap ${CHIP[chip.tono]}`}>{chip.texto}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!grupos.length && <p className="m-0 px-2.5 py-3 text-[13px] font-semibold text-neutral-700">Ningún ajuste coincide con «{busqueda.trim()}».</p>}
        </nav>
        <div id="configuracion-panel" className="flex w-full min-w-0 flex-1 flex-col gap-[18px]">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="m-0 text-[24px] leading-tight font-black tracking-[-0.025em]">{actual.nombre}</h2>
            <span className="text-[13px] font-semibold text-neutral-700">{actual.bajada}</span>
          </div>
          {seccion === 'datos' && <DatosCentro />}
          {seccion === 'horario' && <AvisoSinHorario />}
          {seccion === 'horario' && (
            <div className="flex flex-col items-start gap-[18px] xl:flex-row">
              <div className="w-full min-w-0 flex-1">
                <HorarioCentroEditor />
              </div>
              <div className="w-full min-w-0 xl:w-[360px] xl:flex-none">
                <FeriadosCentro />
              </div>
            </div>
          )}
          {(seccion === 'agenda' || seccion === 'cobros' || seccion === 'equipo' || seccion === 'vinculos') && (
            <ReglasCentro
              seccion={seccion === 'equipo' ? 'roles' : seccion === 'vinculos' ? 'modulos' : seccion}
              nombreSeccion={actual.nombre}
              acuerdos={acuerdosProfesionales}
            />
          )}
          {seccion === 'medios' && <MediosPagoCentro />}
          {seccion === 'avisos' && <PlantillasMensaje />}
          {seccion === 'legal' && <PoliticasCentro />}
          {seccion === 'privacidad' && (
            <>
              <SolicitudesDerechos />
              <AuditoriaAccesos plegable />
              <ExportacionCentro />
            </>
          )}
          {seccion === 'vinculos' && (
            <>
              <ContratoCentroPanel />
              <SoporteCentro />
            </>
          )}
        </div>
      </div>
    </>
  );
}
