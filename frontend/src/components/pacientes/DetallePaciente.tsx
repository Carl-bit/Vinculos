'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

import { CampoRut, rutNormalizado } from '@/components/shared/CampoRut';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { FechaNacimiento } from '@/components/shared/FechaNacimiento';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button, clasesBoton } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EnlaceVolver } from '@/components/ui/EnlaceVolver';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { useBorradores } from '@/lib/fichas';
import { formatoClp, formatoFecha, formatoFechaCorta, formatoRut, formatoTelefono, rutValido } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { useHilos } from '@/lib/mensajes';
import { separarNotas, textoPlano } from '@/lib/notasEvolucion';
import {
  useAdultosResponsables,
  useCitas,
  useEquipoAgenda,
  useEstadoFichas,
  useEvoluciones,
  useFicha,
  usePaciente,
  useTiposAtencion,
  type CitaVista,
  type PacienteVista,
} from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';
import { reglaCorreo, reglaTelefono, useValidacionCampos } from '@/lib/validacion';

import { AccesosPaciente } from './AccesosTemporales';
import { AdjuntosFicha } from './AdjuntosFicha';
import { AltaPaciente } from './AltaPaciente';
import { CobrosPaciente, usePagosPaciente } from './CobrosPaciente';
import { CrearDerivacion } from './CrearDerivacion';
import { DocumentosFicha } from './DocumentosFicha';
import { ExportacionClinicaPendiente } from './ExportacionClinicaPendiente';
import { EvolucionesFicha, useMotivoConsulta } from './FichaClinica';
import { IngresoFicha } from './IngresoFicha';
import {
  AccesoFicha,
  AdultosResponsables,
  ConsentimientoPaciente,
  CuentaPaciente,
  DerivacionRecibida,
  HistorialSesiones,
  IndicacionesPaciente,
  OrigenPaciente,
  useConsentimientoAtencion,
} from './SeccionesPaciente';
import { SolicitudesEpicrisis } from './SolicitudesEpicrisis';

type Seccion = 'resumen' | 'sesiones' | 'evoluciones' | 'documentos' | 'cobros' | 'consentimientos' | 'datos';
/** Trabajo sobre la ficha a pantalla completa (editor y archivo de evoluciones, ficha de ingreso). */
type Foco = 'evoluciones' | 'ingreso';
/** Secciones de la antigua pagina /ficha y de las pestañas (enlaces guardados). */
const ALIAS: Record<string, Seccion> = { adjuntos: 'documentos', accesos: 'datos', alta: 'datos' };

/**
 * Lleva una seccion justo bajo el encabezado fijo (sin animar si se pidio
 * menos movimiento). El encabezado tiene alto constante, asi que el destino
 * calculado no se corre durante el salto.
 */
const irASeccion = (id: Seccion) => {
  const el = document.getElementById(`seccion-${id}`);
  if (!el || typeof window.scrollTo !== 'function') return;
  const alto = document.getElementById('encabezado-paciente')?.offsetHeight ?? 0;
  const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - alto - 12, behavior: quieto ? 'auto' : 'smooth' });
};

/**
 * Vista del paciente (diseño "Profesional flujo del dia y ficha completa"):
 * una sola pagina con indice, sin pestañas.
 * - Encabezado de identidad fijo (prevencion de errores de paciente): nombre,
 *   edad, RUT, sesiones y tratante; datos rapidos; el SIGUIENTE PASO (lo mas
 *   urgente, con su accion) y el indice de la ficha con lo pendiente por
 *   seccion. Datos rapidos y siguiente paso bajo el encabezado.
 * - Equipo con acceso clinico (tratante o acceso temporal): Resumen (motivo,
 *   ultima evolucion, equipo y contacto), Sesiones, Evoluciones, Documentos,
 *   Cobros, Consentimientos y Datos. El editor y archivo de evoluciones y el
 *   ingreso se abren a pantalla completa (`?vista=evoluciones|ingreso`).
 * - ADMIN/GESTION: Sesiones (estado administrativo), Cobros, Consentimientos
 *   y Datos. Nunca contenido clinico.
 * Toda lectura clinica pasa por los mismos endpoints (accesos_ficha).
 * `embebido`: dentro del riel "Mis pacientes" del profesional (sin "Volver").
 */
export function DetallePaciente({ id, rol, embebido = false }: { id: string; rol: Rol; embebido?: boolean }) {
  const consulta = usePaciente(id);
  return (
    <EstadoConsulta consulta={consulta}>
      {(p) => (
        <>
          {!embebido && <EnlaceVolver href="/admin/fichas">Volver al listado</EnlaceVolver>}
          <VistaPaciente key={p.id} paciente={p} rol={rol} />
        </>
      )}
    </EstadoConsulta>
  );
}

function VistaPaciente({ paciente: p, rol }: { paciente: PacienteVista; rol: Rol }) {
  const router = useRouter();
  const parametros = useSearchParams();
  const cuenta = useMiCuenta();
  const modulos = useModulos();
  const admin = esAdministracion(rol);
  const rolClinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const tratante = !!cuenta.data?.id && p.profesionalId === cuenta.data.id;
  const ficha = useFicha(p.id, rolClinico);
  // Acceso clinico: el tratante (aunque la ficha aun no este abierta) o quien la ve por un acceso temporal.
  const clinico = rolClinico && (tratante || !!ficha.data);
  const conCobros = rol !== 'PRACTICANTE' && !!modulos.data?.activos.includes('COBROS');
  const [editar, setEditar] = useState(false);
  // `?derivar=1`: llega desde el detalle de una sesion en la agenda ("Derivar paciente").
  const [derivar, setDerivar] = useState(parametros.get('derivar') === '1');
  const estado = useEstadoPaciente(p, rol, clinico, tratante, ficha.data?.id, conCobros);

  // Resumen y Datos primero: lo que se mira al abrir la ficha, sin bajar hasta el fondo.
  const secciones: { id: Seccion; etiqueta: string; n?: number }[] = [
    ...(clinico && ficha.data ? [{ id: 'resumen' as const, etiqueta: 'Resumen' }] : []),
    { id: 'datos', etiqueta: 'Datos', n: (p.rut ? 0 : 1) + (estado.faltaAdulto ? 1 : 0) },
    { id: 'sesiones', etiqueta: 'Sesiones' },
    ...(clinico
      ? ([
          { id: 'evoluciones', etiqueta: 'Evoluciones', n: estado.sinEvolucion + estado.borradores },
          { id: 'documentos', etiqueta: 'Documentos' },
        ] as const)
      : []),
    ...(conCobros ? [{ id: 'cobros' as const, etiqueta: 'Cobros', n: estado.porPagar }] : []),
    { id: 'consentimientos', etiqueta: 'Consentimientos', n: estado.consentimientoPendiente ? 1 : 0 },
  ];
  const pedida = parametros.get('vista') ?? '';
  const foco: Foco | null = clinico && (pedida === 'evoluciones' || pedida === 'ingreso') ? pedida : null;
  // ?seccion= (o un ?vista= de las antiguas pestañas) lleva a esa seccion de la ficha.
  const pedidaSeccion = parametros.get('seccion') ?? pedida;
  const destino = secciones.find((s) => s.id === (ALIAS[pedidaSeccion] ?? pedidaSeccion))?.id;
  const [actual, setActual] = useState<Seccion>(destino ?? secciones[0]!.id);

  /** Abre el trabajo a pantalla completa o vuelve a la ficha en una seccion. */
  const ir = (v: Foco, extra = '') => router.replace(`/admin/fichas/${p.id}?vista=${v}${extra}`, { scroll: false });
  const volver = (s: Seccion) => router.replace(`/admin/fichas/${p.id}?seccion=${s}`, { scroll: false });

  // Tras un clic en el indice, la seccion elegida queda marcada hasta que el salto termina
  // (si no, el indice va marcando las secciones por las que pasa, o la ultima al llegar al fondo).
  const elegida = useRef<{ id: Seccion; hasta: number } | null>(null);
  const saltar = (s: Seccion) => {
    elegida.current = { id: s, hasta: Date.now() + 1000 };
    setActual(s);
    irASeccion(s);
  };

  // Enlace con ?vista=<seccion>: llega a esa seccion. Despues, el indice sigue el scroll.
  useEffect(() => {
    if (!foco && destino) requestAnimationFrame(() => saltar(destino));
  }, [foco, destino]);
  const ids = secciones.map((s) => s.id).join();
  useEffect(() => {
    if (foco) return;
    const marcar = () => {
      const fijada = elegida.current;
      if (fijada && Date.now() < fijada.hasta) {
        fijada.hasta = Date.now() + 200; // sigue el salto: se libera 200 ms despues del ultimo movimiento
        return;
      }
      elegida.current = null;
      // Seccion activa: la ultima cuyo inicio ya paso bajo el encabezado fijo.
      const borde = (document.getElementById('encabezado-paciente')?.offsetHeight ?? 0) + 24;
      let activa = ids.split(',')[0] as Seccion;
      for (const id of ids.split(',') as Seccion[]) {
        const el = document.getElementById(`seccion-${id}`);
        if (el && el.getBoundingClientRect().top <= borde) activa = id;
      }
      setActual(activa);
    };
    window.addEventListener('scroll', marcar, { passive: true });
    return () => window.removeEventListener('scroll', marcar);
  }, [foco, ids]);

  // Siguiente paso: lo mas urgente de la ficha, con la accion que lo resuelve.
  const paso: { texto: string; boton: string; accion: () => void } | null = clinico
    ? estado.sinEvolucion > 0
      ? {
          texto:
            estado.sinEvolucion === 1
              ? 'Hay una sesión realizada sin evolución registrada.'
              : `Hay ${estado.sinEvolucion} sesiones realizadas sin evolución registrada.`,
          boton: 'Registrar evolución',
          accion: () => ir('evoluciones', '&nueva=1'),
        }
      : estado.borradores > 0
        ? { texto: 'Tienes un borrador de evolución sin confirmar.', boton: 'Abrir borrador', accion: () => ir('evoluciones') }
        : null
    : null;
  const pasoAdministrativo = !p.rut
    ? {
        texto: 'Falta el RUT: se exige antes de la primera evolución.',
        boton: 'Completar RUT',
        accion: () => document.getElementById('registro-rut')?.scrollIntoView?.(),
      }
    : estado.faltaAdulto
      ? {
          texto: 'Es menor de edad y no tiene adulto responsable: sus horas no se pueden confirmar.',
          boton: 'Registrar adulto',
          accion: () => saltar('datos'),
        }
      : estado.consentimientoPendiente
        ? {
            texto: `El consentimiento informado sigue pendiente${estado.proxima ? ` y la próxima sesión es el ${formatoFechaCorta(estado.proxima)}` : ''}.`,
            boton: 'Ver consentimiento',
            accion: () => saltar('consentimientos'),
          }
        : estado.porPagar > 0
          ? {
              texto: estado.porPagar === 1 ? 'Tiene un pago pendiente.' : `Tiene ${estado.porPagar} pagos pendientes.`,
              boton: 'Ver cobros',
              accion: () => saltar(conCobros ? 'cobros' : 'sesiones'),
            }
          : null;

  return (
    <>
      <EncabezadoPaciente
        paciente={p}
        rol={rol}
        estado={estado}
        paso={paso ?? pasoAdministrativo}
        secciones={secciones}
        actual={foco ? null : actual}
        onSeccion={(s) => (foco ? volver(s) : saltar(s))}
        acciones={
          <>
            {clinico && (
              <Button variant="team" icon="edit_note" disabled={!ficha.data} onClick={() => ir('evoluciones', '&nueva=1')}>
                Registrar evolución
              </Button>
            )}
            <ButtonLink href={`/admin/agenda?paciente=${p.id}`} variant={clinico ? 'secondary' : 'team'} icon="event">
              Agendar
            </ButtonLink>
            {tratante && rol === 'PROFESIONAL' && (
              <Button variant="secondary" icon="call_split" onClick={() => setDerivar(true)}>
                Derivar
              </Button>
            )}
            <MasAcciones
              opciones={[
                { icono: 'edit', texto: 'Editar datos', accion: () => setEditar(true) },
                ...(clinico && ficha.data
                  ? [
                      { icono: 'assignment' as const, texto: 'Ficha de ingreso', accion: () => ir('ingreso') },
                      { icono: 'folder_open' as const, texto: 'Archivo de evoluciones', accion: () => ir('evoluciones') },
                    ]
                  : []),
              ]}
            />
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 empty:hidden">
        {p.bloqueoDesde && (
          <Aviso tono="advertencia" icono="lock" titulo="Tratamiento bloqueado por solicitud del titular">
            Desde el {formatoFecha(p.bloqueoDesde)}: {p.bloqueoMotivo}. No se pueden agendar horas nuevas, derivar ni editar sus datos hasta que administración
            levante el bloqueo. Las horas ya agendadas se mantienen y se registra su atención.
          </Aviso>
        )}
        {!p.rut && <RegistroRut paciente={p} />}
        {p.posibleDuplicado && <Duplicado paciente={p} admin={admin} />}
      </div>

      {foco ? (
        <div className="entrada flex flex-col gap-4" key={foco}>
          <button
            type="button"
            onClick={() => volver(foco === 'ingreso' && secciones[0]!.id === 'resumen' ? 'resumen' : 'evoluciones')}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 self-start rounded-full px-2 text-[13.5px] font-extrabold text-accent-700 hover:bg-accent-100"
          >
            <Icon name="arrow_back" size={18} />
            Volver a la ficha
          </button>
          {foco === 'evoluciones' &&
            (ficha.data ? (
              <EvolucionesFicha
                fichaId={ficha.data.id}
                paciente={p}
                citaInicial={parametros.get('cita') ?? undefined}
                borradorInicial={parametros.get('borrador') ?? undefined}
                nueva={parametros.get('nueva') === '1'}
                rol={rol}
              />
            ) : (
              <AccesoFicha paciente={p} rol={rol} tratante={tratante} />
            ))}
          {foco === 'ingreso' &&
            (ficha.data ? <IngresoFicha fichaId={ficha.data.id} miId={cuenta.data?.id} /> : <AccesoFicha paciente={p} rol={rol} tratante={tratante} />)}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {clinico && ficha.data && (
            <Seccion id="resumen" etiqueta="Resumen">
              <ResumenClinico paciente={p} fichaId={ficha.data.id} onIngreso={() => ir('ingreso')} onEvoluciones={() => saltar('evoluciones')} />
            </Seccion>
          )}
          <Seccion id="datos" etiqueta="Datos">
            {clinico && tratante && <IndicacionesPaciente pacienteId={p.id} />}
            <AdultosResponsables paciente={p} />
            {!clinico && <AccesoFicha paciente={p} rol={rol} tratante={tratante} />}
            {(rol === 'ADMIN' || (rol === 'PROFESIONAL' && tratante)) && (
              <AccesosPaciente pacienteId={p.id} tratanteId={p.profesionalId} puedeOtorgar={rol === 'ADMIN' || tratante} />
            )}
            {rol === 'PROFESIONAL' && tratante && ficha.data && <AltaPaciente pacienteId={p.id} />}
            {admin && <SolicitudesEpicrisis pacienteId={p.id} puedeResolver={rol === 'ADMIN'} />}
            {admin && <CuentaPaciente paciente={p} />}
            {admin && <OrigenPaciente paciente={p} />}
          </Seccion>
          <Seccion id="sesiones" etiqueta="Sesiones">
            <DerivacionRecibida pacienteId={p.id} habilitado={rol === 'ADMIN' || tratante} />
            <HistorialSesiones paciente={p} rol={rol} tratante={tratante} />
          </Seccion>
          {clinico && (
            <Seccion id="evoluciones" etiqueta="Evoluciones">
              {ficha.data ? (
                <EvolucionesRecientes fichaId={ficha.data.id} onAbrir={() => ir('evoluciones')} onNueva={() => ir('evoluciones', '&nueva=1')} />
              ) : (
                <AccesoFicha paciente={p} rol={rol} tratante={tratante} />
              )}
            </Seccion>
          )}
          {clinico && (
            <Seccion id="documentos" etiqueta="Documentos y adjuntos">
              <ExportacionClinicaPendiente pacienteId={p.id} tratante={tratante && rol === 'PROFESIONAL'} />
              <SolicitudesEpicrisis pacienteId={p.id} puedeResolver />
              <DocumentosFicha pacienteId={p.id} />
              <AdjuntosFicha pacienteId={p.id} />
            </Seccion>
          )}
          {conCobros && (
            <Seccion id="cobros" etiqueta="Cobros">
              <CobrosPaciente pacienteId={p.id} />
            </Seccion>
          )}
          <Seccion id="consentimientos" etiqueta="Consentimientos">
            <ConsentimientoPaciente paciente={p} rol={rol} />
          </Seccion>
          {/* Espacio final: la ultima seccion tambien puede quedar bajo el encabezado al saltar. */}
          <div aria-hidden="true" className="h-[75vh]" />
        </div>
      )}
      {tratante && (
        <CrearDerivacion
          paciente={p}
          abierto={derivar}
          onCerrar={() => {
            setDerivar(false);
            if (parametros.get('derivar')) router.replace(`/admin/fichas/${p.id}`, { scroll: false });
          }}
        />
      )}
      <Modal abierto={editar} onCerrar={() => setEditar(false)} titulo="Editar datos del paciente" ancho="lg">
        {editar && <EditarPaciente paciente={p} onListo={() => setEditar(false)} />}
      </Modal>
    </>
  );
}

/** Seccion de la ficha: destino del indice (queda bajo el encabezado fijo al saltar). */
function Seccion({ id, etiqueta, children }: { id: Seccion; etiqueta: string; children: ReactNode }) {
  return (
    <section id={`seccion-${id}`} aria-label={etiqueta} className="flex scroll-mt-[230px] flex-col gap-4">
      {children}
    </section>
  );
}

const OPCION_MENU =
  'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-3 text-left text-[13.5px] font-bold text-text hover:bg-accent-100 focus-visible:bg-accent-100';

/** "Mas acciones" (…): lista que se abre bajo el boton y se cierra con Escape o al salir con el foco. */
function MasAcciones({ opciones }: { opciones: { icono: Icono; texto: string; accion: () => void }[] }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const teclas = {
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    },
    onBlur: (e: FocusEvent) => {
      if (!caja.current?.contains(e.relatedTarget as Node | null)) setAbierto(false);
    },
  };
  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        aria-label="Más acciones"
        aria-expanded={abierto}
        aria-controls="mas-acciones"
        onClick={() => setAbierto((a) => !a)}
        {...teclas}
        className={`${clasesBoton('secondary')} !px-3`}
      >
        <Icon name="expand_more" size={20} />
      </button>
      {abierto && (
        <div id="mas-acciones" className="absolute right-0 z-10 mt-1.5 flex w-60 flex-col gap-0.5 rounded-sm border border-divider bg-bg p-1.5 shadow-lg">
          {opciones.map((o) => (
            <button
              key={o.texto}
              type="button"
              {...teclas}
              onClick={() => {
                setAbierto(false);
                o.accion();
              }}
              className={OPCION_MENU}
            >
              <Icon name={o.icono} size={17} />
              {o.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Modalidad mas frecuente de sus sesiones (nula sin sesiones). */
const modalidadHabitual = (citas: CitaVista[]) => {
  const online = citas.filter((c) => c.modalidad === 'ONLINE').length;
  return citas.length === 0 ? null : online * 2 > citas.length ? 'ONLINE' : 'PRESENCIAL';
};

/** Estado de la ficha para el encabezado, el siguiente paso y los contadores del indice. */
function useEstadoPaciente(p: PacienteVista, rol: Rol, clinico: boolean, tratante: boolean, fichaId: string | undefined, conCobros: boolean) {
  const admin = esAdministracion(rol);
  const citas = useCitas({ pacienteId: p.id });
  const equipo = useEquipoAgenda();
  const tipos = useTiposAtencion();
  const adultos = useAdultosResponsables(p.id);
  // Estado administrativo (alta, sesiones sin evolucion): ADMIN/GESTION o el propio tratante.
  const estados = useEstadoFichas(admin || tratante ? (p.profesionalId ?? undefined) : undefined);
  const estado = estados.data?.find((e) => e.paciente_id === p.id);
  const borradores = useBorradores(fichaId, clinico && !!fichaId);
  const consentimiento = useConsentimientoAtencion(p.id);
  const pagos = usePagosPaciente(p.id, conCobros);
  const tarifas = useQuery({
    queryKey: ['panel', 'tarifas', p.profesionalId],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/tarifas', { params: { path: { id: p.profesionalId! } } })),
    enabled: !!p.profesionalId && (admin || (rol === 'PROFESIONAL' && tratante)),
  });
  const ahora = Date.now();
  const lista = citas.data ?? [];
  const habitual = modalidadHabitual(lista.filter((c) => c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO'));
  const vigentes = (tarifas.data ?? []).filter((t) => new Date(t.vigenteDesde).getTime() <= ahora).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  const edad = edadEn(p.fechaNacimiento);
  return {
    edad,
    estado,
    habitual,
    // La mas especifica: tipo y modalidad, solo tipo, solo modalidad, general.
    tarifa:
      vigentes.find((t) => t.tipoAtencionId === p.tipoAtencionId && t.modalidad === habitual) ??
      vigentes.find((t) => t.tipoAtencionId === p.tipoAtencionId && !t.modalidad) ??
      vigentes.find((t) => !t.tipoAtencionId && t.modalidad === habitual) ??
      vigentes.find((t) => !t.tipoAtencionId && !t.modalidad),
    realizadas: lista.filter((c) => c.estado === 'CONFIRMADA' && new Date(c.fin).getTime() <= ahora).length,
    proxima: lista
      .filter((c) => (c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO') && new Date(c.inicio).getTime() >= ahora)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))[0]?.inicio,
    tratanteNombre: equipo.data?.find((m) => m.id === p.profesionalId)?.nombre,
    tipo: tipos.data?.find((t) => t.id === p.tipoAtencionId)?.nombre,
    adultos: adultos.data ?? [],
    faltaAdulto: edad < 18 && adultos.isSuccess && adultos.data.length === 0,
    sinEvolucion: clinico ? (estado?.sesiones_sin_cerrar ?? 0) : 0,
    borradores: borradores.data?.length ?? 0,
    consentimientoPendiente: !!consentimiento.vigente.data && !consentimiento.alDia && consentimiento.aceptaciones.isSuccess,
    porPagar: conCobros
      ? (pagos.data ?? []).filter((c) => c.saldo > 0 && c.estado_cita !== 'CANCELADA').length
      : lista.filter((c) => c.estado === 'PENDIENTE_PAGO').length,
  };
}
type EstadoPaciente = ReturnType<typeof useEstadoPaciente>;

/** Iniciales para el avatar del encabezado. */
const iniciales = (p: PacienteVista) => `${p.nombre[0] ?? ''}${p.apellido[0] ?? ''}`.toUpperCase();

/**
 * Encabezado de identidad fijo (CENS, prevencion de errores de paciente):
 * identidad, acciones e indice siempre a la vista, con alto constante (si
 * cambiara de alto al bajar, el contenido se moveria y el scroll y los saltos
 * del indice quedarian corridos). Datos rapidos y siguiente paso van debajo,
 * en el flujo, y se van con el scroll.
 */
function EncabezadoPaciente({
  paciente: p,
  rol,
  estado: e,
  paso,
  secciones,
  actual,
  onSeccion,
  acciones,
}: {
  paciente: PacienteVista;
  rol: Rol;
  estado: EstadoPaciente;
  paso: { texto: string; boton: string; accion: () => void } | null;
  secciones: { id: Seccion; etiqueta: string; n?: number }[];
  actual: Seccion | null;
  onSeccion: (s: Seccion) => void;
  acciones: ReactNode;
}) {
  const admin = esAdministracion(rol);
  return (
    <>
      <header
        id="encabezado-paciente"
        aria-label="Identidad del paciente"
        className="sticky top-0 z-[5] flex flex-col gap-4 rounded-b-lg border border-t-0 border-neutral-400 bg-bg px-[clamp(18px,2.4vw,28px)] pt-5 pb-3.5 shadow-lg"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span aria-hidden="true" className="grid size-14 flex-none place-items-center rounded-full bg-accent-200 text-[17px] font-black text-accent-900">
            {iniciales(p)}
          </span>
          <div className="min-w-0 flex-[1_1_280px]">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0 text-[clamp(26px,2.8vw,34px)] leading-[1.05] font-black tracking-[-0.03em]">
                {p.nombre} {p.apellido}
              </h1>
              {e.edad < 18 && <Badge tono="atencion">Menor de edad</Badge>}
              {e.estado && (
                <Badge tono={e.estado.alta_en ? 'neutro' : 'positivo'}>{e.estado.alta_en ? `Alta ${formatoFecha(e.estado.alta_en)}` : 'Activo'}</Badge>
              )}
              {p.traidoPorCentro && <Badge>Llegó por el centro</Badge>}
            </div>
            <p className="m-0 mt-1.5 text-[14.5px] font-semibold text-neutral-800">
              {e.edad} años · {p.rut ? `RUT ${formatoRut(p.rut)}` : 'Sin RUT'} · {e.realizadas === 1 ? '1 sesión' : `${e.realizadas} sesiones`}
              {e.tipo ? ` · ${e.tipo}` : ''}
              {` · Tratante: ${e.tratanteNombre ?? (p.profesionalId ? 'profesional del centro' : 'sin asignar')}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">{acciones}</div>
        </div>

        <dl className="m-0 grid gap-x-6 gap-y-2.5 rounded-sm bg-neutral-100 px-4 py-3 text-[14px] [grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr))]">
          {p.email && <DatoRapido etiqueta="Correo" valor={p.email} copiar />}
          {p.telefono && <DatoRapido etiqueta="Teléfono" valor={formatoTelefono(p.telefono)} copiar={p.telefono} />}
          {e.habitual && <DatoRapido etiqueta="Modalidad habitual" valor={e.habitual === 'ONLINE' ? 'Online' : 'Presencial'} />}
          {e.tarifa && <DatoRapido etiqueta="Tarifa vigente" valor={formatoClp(e.tarifa.monto)} />}
          {e.edad < 18 && (
            <DatoRapido
              etiqueta="Adulto responsable"
              valor={e.adultos.map((a) => `${a.nombre}${a.parentesco ? ` (${a.parentesco})` : ''}`).join(', ') || 'Falta registrarlo'}
            />
          )}
          {p.contactoEmergencia && <DatoRapido etiqueta="Emergencia" valor={p.contactoEmergencia.split('\n')[0]!} />}
        </dl>

        <nav aria-label="Índice de la ficha" className="flex flex-wrap gap-0.5 border-t border-divider pt-2">
          {secciones.map((s) => (
            <a
              key={s.id}
              href={`#seccion-${s.id}`}
              aria-current={actual === s.id ? 'location' : undefined}
              onClick={(ev) => {
                ev.preventDefault();
                onSeccion(s.id);
              }}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-extrabold transition-colors duration-200 ${
                actual === s.id ? 'bg-text text-neutral-100 hover:text-neutral-100' : 'text-text hover:bg-accent-100 hover:text-text'
              }`}
            >
              {s.etiqueta}
              {!!s.n && (
                <span className="rounded-full bg-pendiente-100 px-1.5 text-[10.5px] font-black text-pendiente-900">
                  <span className="sr-only">pendientes: </span>
                  {s.n}
                </span>
              )}
            </a>
          ))}
          {admin && <span className="sr-only">Sin contenido clínico desde este perfil.</span>}
        </nav>
      </header>
      {/* Siguiente paso: bajo el encabezado fijo, se va con el scroll (el encabezado no cambia de alto). */}
      <div className="mt-3 mb-4 flex flex-col gap-3 empty:hidden">
        {paso && (
          <div role="status" aria-label="Siguiente paso" className="flex flex-wrap items-center gap-2.5 rounded-sm bg-text px-3.5 py-2.5 text-neutral-100">
            <span className="text-[11px] font-extrabold tracking-[0.1em] text-pendiente-100 uppercase">Siguiente paso</span>
            <span className="flex-[1_1_240px] text-[13.5px] font-bold">{paso.texto}</span>
            <button
              type="button"
              onClick={paso.accion}
              className="min-h-9 cursor-pointer rounded-full bg-pendiente-100 px-3.5 text-[13px] font-black text-pendiente-900 transition-colors duration-200 hover:bg-neutral-100"
            >
              {paso.boton}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Dato del encabezado; `copiar` (true o el valor en bruto) agrega el boton de copiar. */
function DatoRapido({ etiqueta, valor, copiar }: { etiqueta: string; valor: string; copiar?: boolean | string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">{etiqueta}</dt>
      <dd className="m-0 flex min-h-8 min-w-0 items-center gap-1 font-bold">
        <span className="truncate">{valor}</span>
        {copiar && (
          <button
            type="button"
            aria-label={copiado ? `${etiqueta} copiado` : `Copiar ${etiqueta.toLowerCase()}`}
            onClick={() => {
              void navigator.clipboard?.writeText(typeof copiar === 'string' ? copiar : valor).then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 1500);
              });
            }}
            className="grid size-8 flex-none cursor-pointer place-items-center rounded-full text-neutral-700 hover:bg-accent-100 hover:text-accent-700"
          >
            <Icon name={copiado ? 'check' : 'content_copy'} size={16} />
          </button>
        )}
      </dd>
    </div>
  );
}

const TARJETA = 'flex min-w-0 flex-col gap-1.5 rounded-md border border-divider bg-neutral-100 p-4';
const ROTULO = 'm-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase';

/**
 * Resumen del tratante: motivo de consulta, ultima evolucion y equipo y
 * contacto. Lecturas auditadas por la API.
 */
function ResumenClinico({
  paciente: p,
  fichaId,
  onIngreso,
  onEvoluciones,
}: {
  paciente: PacienteVista;
  fichaId: string;
  onIngreso: () => void;
  onEvoluciones: () => void;
}) {
  const motivo = useMotivoConsulta(p.id, fichaId);
  const evoluciones = useEvoluciones(fichaId, true);
  const hilos = useHilos(p.id);
  const ultima = [...(evoluciones.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const sinIngreso = motivo === 'Sin ficha de ingreso registrada.';
  const conversaciones = hilos.data ?? [];
  const noLeidos = conversaciones.reduce((s, h) => s + h.noLeidos, 0);
  return (
    <div className="grid gap-3.5 md:grid-cols-3">
      <div className={TARJETA}>
        <p className={ROTULO}>Motivo de consulta</p>
        <p className="m-0 line-clamp-4 text-[14px] font-semibold whitespace-pre-line">{motivo}</p>
        <button type="button" onClick={onIngreso} className="cursor-pointer self-start text-[13px] font-extrabold text-accent-700 hover:underline">
          {sinIngreso ? 'Completar ingreso' : 'Ver ficha de ingreso'}
        </button>
      </div>
      <div className={TARJETA}>
        <p className={ROTULO}>Última evolución{ultima ? ` · ${formatoFechaCorta(ultima.createdAt)}` : ''}</p>
        <p className="m-0 line-clamp-4 text-[14px] font-semibold whitespace-pre-line">
          {evoluciones.isPending ? '…' : ultima ? textoPlano(ultima.notas ?? '') : 'Todavía no hay evoluciones.'}
        </p>
        {ultima?.estadoAvance && <Badge tono="positivo">{ultima.estadoAvance.nombre}</Badge>}
        {ultima && (
          <button type="button" onClick={onEvoluciones} className="cursor-pointer self-start text-[13px] font-extrabold text-accent-700 hover:underline">
            Ver evoluciones
          </button>
        )}
      </div>
      <div className={TARJETA}>
        <p className={ROTULO}>Equipo y contacto</p>
        <p className="m-0 text-[13.5px] font-semibold">
          Contacto de emergencia:{' '}
          {p.contactoEmergencia ? <strong>{p.contactoEmergencia.split('\n')[0]}</strong> : <strong className="text-pendiente-900">sin registrar</strong>}
        </p>
        <p className="m-0 text-[13.5px] font-semibold">
          {conversaciones.length === 0
            ? 'Sin conversaciones del equipo sobre esta ficha'
            : `${conversaciones.length === 1 ? '1 conversación' : `${conversaciones.length} conversaciones`} del equipo${noLeidos ? ` · ${noLeidos} sin leer` : ''}`}
        </p>
        <Link
          href={conversaciones[0] ? `/admin/mensajes?hilo=${conversaciones[0].id}` : `/admin/mensajes?caso=${p.id}`}
          className="self-start text-[13px] font-extrabold text-accent-700 hover:underline"
        >
          {conversaciones[0] ? 'Abrir conversación del caso' : 'Nueva conversación del caso'}
        </Link>
      </div>
    </div>
  );
}

/** Evoluciones: las tres ultimas en tarjetas; el editor y el archivo completo se abren a pantalla completa. */
function EvolucionesRecientes({ fichaId, onAbrir, onNueva }: { fichaId: string; onAbrir: () => void; onNueva: () => void }) {
  const evoluciones = useEvoluciones(fichaId, true);
  const todas = [...(evoluciones.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recientes = todas.slice(-3).reverse();
  return (
    <Panel
      titulo="Evoluciones"
      bajada={todas.length ? `${todas.length === 1 ? '1 registrada' : `${todas.length} registradas`} · las más recientes` : undefined}
      accion={
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="folder_open" onClick={onAbrir} className="!px-4 !py-2.5 !text-[13px]">
            Abrir archivo
          </Button>
          <Button variant="team" icon="edit_note" onClick={onNueva} className="!px-4 !py-2.5 !text-[13px]">
            Registrar evolución
          </Button>
        </span>
      }
    >
      <EstadoConsulta consulta={evoluciones} vacio={() => todas.length === 0} textoVacio="Todavía no hay evoluciones registradas">
        {() => (
          <div className="grid gap-3 md:grid-cols-3">
            {recientes.map((ev, i) => {
              const { titulo } = separarNotas(ev.notas ?? '');
              return (
                <article key={ev.id} className={`flex min-w-0 flex-col gap-1.5 rounded-md border border-divider p-3.5 ${i === 0 ? 'bg-accent-100' : 'bg-bg'}`}>
                  <span className="text-[11px] font-extrabold tracking-[0.08em] text-accent-700 uppercase">
                    {formatoFechaCorta(ev.createdAt)} · Sesión {todas.indexOf(ev) + 1}
                  </span>
                  <strong className="text-[14px]">{titulo || ev.tipoSesion?.nombre || 'Evolución'}</strong>
                  <span className="line-clamp-3 text-[13px] font-semibold text-neutral-800">{textoPlano(ev.notas ?? '')}</span>
                </article>
              );
            })}
          </div>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

/** Recepcion: el RUT es obligatorio antes de la primera evolucion (la BD lo exige). */
function RegistroRut({ paciente }: { paciente: PacienteVista }) {
  const cliente = useQueryClient();
  const [rut, setRut] = useState('');
  const [error, setError] = useState<string>();
  const guardar = useMutation({
    mutationFn: () => datos(api.PATCH('/api/pacientes/{id}', { params: { path: { id: paciente.id } }, body: { rut: rutNormalizado(rut) } })),
    onSuccess: (p) => cliente.setQueryData(['panel', 'paciente', paciente.id], p),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el RUT.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!rutValido(rut)) {
      setError('El RUT no es válido. Revisa el dígito verificador.');
      return;
    }
    setError(undefined);
    guardar.mutate();
  };
  return (
    <Aviso tono="advertencia" icono="badge" titulo="Falta el RUT del paciente">
      <p className="m-0 mb-3">Regístralo en recepción: se exige antes de la primera evolución y evita registros duplicados.</p>
      <form onSubmit={enviar} noValidate className="flex flex-wrap items-start gap-2.5">
        <div className="w-full max-w-[240px]">
          <CampoRut label="RUT" error={error} value={rut} onChange={setRut} />
        </div>
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending} className="mt-[26px]">
          Guardar RUT
        </Button>
      </form>
    </Aviso>
  );
}

/** Posible duplicado (D-2): nunca se fusiona por nombre; solo administracion concilia y queda auditado. */
function Duplicado({ paciente, admin }: { paciente: PacienteVista; admin: boolean }) {
  const cliente = useQueryClient();
  const [confirmar, setConfirmar] = useState<'DISTINTO' | 'MISMO_PACIENTE' | null>(null);
  const resolver = useMutation({
    mutationFn: (resolucion: 'DISTINTO' | 'MISMO_PACIENTE') =>
      datos(api.POST('/api/pacientes/{id}/duplicado-revisado', { params: { path: { id: paciente.id } }, body: { resolucion } })),
    onSuccess: (p) => {
      setConfirmar(null);
      cliente.setQueryData(['panel', 'paciente', paciente.id], p);
      void cliente.invalidateQueries({ queryKey: ['panel', 'pacientes'] });
    },
  });
  return (
    <Aviso
      tono="advertencia"
      icono="person_search"
      titulo="Posible duplicado"
      accion={
        admin ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmar('DISTINTO')} className="!py-2.5">
              Es otra persona
            </Button>
            <Button variant="secondary" onClick={() => setConfirmar('MISMO_PACIENTE')} className="!py-2.5">
              Es el mismo paciente
            </Button>
          </>
        ) : undefined
      }
    >
      {admin
        ? 'Otro registro coincide en RUT o correo. Revisa ambos antes de decidir: la resolución queda auditada.'
        : 'Otro registro coincide en RUT o correo. Lo concilia administración.'}
      <Modal
        abierto={!!confirmar}
        onCerrar={() => setConfirmar(null)}
        titulo={confirmar === 'DISTINTO' ? '¿Es otra persona?' : '¿Es el mismo paciente?'}
        descripcion={
          confirmar === 'DISTINTO'
            ? 'Se quita la marca de posible duplicado. Los dos registros siguen separados.'
            : 'Queda registrado que ambos registros son la misma persona. Los registros no se fusionan solos: el traspaso de fichas se hace aparte.'
        }
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmar(null)}>
              Volver
            </Button>
            <Button variant="team" loading={resolver.isPending} onClick={() => confirmar && resolver.mutate(confirmar)}>
              Confirmar
            </Button>
          </>
        }
      >
        {resolver.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {resolver.error instanceof ApiError ? resolver.error.message : 'No pudimos registrar la resolución.'}
          </p>
        )}
      </Modal>
    </Aviso>
  );
}

function EditarPaciente({ paciente, onListo }: { paciente: PacienteVista; onListo: () => void }) {
  const cliente = useQueryClient();
  const [d, setD] = useState({
    nombre: paciente.nombre,
    apellido: paciente.apellido,
    fechaNacimiento: paciente.fechaNacimiento.slice(0, 10),
    email: paciente.email ?? '',
    telefono: paciente.telefono ?? '',
    contactoEmergencia: paciente.contactoEmergencia ?? '',
  });
  const [error, setError] = useState<string>();
  const formato = useValidacionCampos({ email: reglaCorreo(), telefono: reglaTelefono });
  const cambiar = (k: keyof typeof d, v: string) => {
    if (k === 'email' || k === 'telefono') formato.limpiar(k);
    setD((x) => ({ ...x, [k]: v }));
  };
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/pacientes/{id}', {
          params: { path: { id: paciente.id } },
          body: {
            nombre: d.nombre.trim(),
            apellido: d.apellido.trim(),
            fechaNacimiento: d.fechaNacimiento,
            email: d.email.trim().toLowerCase() || undefined,
            telefono: d.telefono.replace(/[\s()-]/g, '') || undefined,
            contactoEmergencia: d.contactoEmergencia.trim() || undefined,
          },
        }),
      ),
    onSuccess: (p) => {
      cliente.setQueryData(['panel', 'paciente', paciente.id], p);
      void cliente.invalidateQueries({ queryKey: ['panel', 'pacientes'] });
      onListo();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar los cambios.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!d.nombre.trim() || !d.apellido.trim() || !d.fechaNacimiento) {
      setError('Nombre, apellido y fecha de nacimiento son obligatorios.');
      return;
    }
    if (!formato.validarTodo({ email: d.email, telefono: d.telefono })) return;
    setError(undefined);
    guardar.mutate();
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required>
          {(p) => <Input {...p} value={d.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
        </Field>
        <Field label="Apellido" required>
          {(p) => <Input {...p} value={d.apellido} onChange={(e) => cambiar('apellido', e.target.value)} />}
        </Field>
        <FechaNacimiento
          label="Fecha de nacimiento"
          required
          hint="Define si es menor de edad: para agendarle horas a un menor hace falta su adulto responsable."
          value={d.fechaNacimiento}
          onChange={(v) => cambiar('fechaNacimiento', v)}
          avisoMenor="Con esta fecha es menor de edad: necesita un adulto responsable registrado para agendar."
        />
        <Field label="Correo" error={formato.errores.email}>
          {(p) => (
            <Input {...p} type="email" value={d.email} onChange={(e) => cambiar('email', e.target.value)} onBlur={() => formato.alSalir('email', d.email)} />
          )}
        </Field>
        <Field label="Teléfono" error={formato.errores.telefono} hint="Con código de país, por ejemplo +56 9 1234 5678.">
          {(p) => (
            <Input
              {...p}
              type="tel"
              value={d.telefono}
              onChange={(e) => cambiar('telefono', e.target.value)}
              onBlur={() => formato.alSalir('telefono', d.telefono)}
            />
          )}
        </Field>
      </div>
      <Field label="Contacto de emergencia" hint="Nombre, relación y teléfono. Se guarda cifrado.">
        {(p) => <Textarea {...p} rows={2} value={d.contactoEmergencia} onChange={(e) => cambiar('contactoEmergencia', e.target.value)} className="!min-h-16" />}
      </Field>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
