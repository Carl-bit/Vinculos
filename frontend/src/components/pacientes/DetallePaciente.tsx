'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { CampoRut, rutNormalizado } from '@/components/shared/CampoRut';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { FechaNacimiento } from '@/components/shared/FechaNacimiento';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EnlaceVolver } from '@/components/ui/EnlaceVolver';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { Pestanas } from '@/components/ui/Pestanas';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { useBorradores, useIngresos } from '@/lib/fichas';
import { formatoClp, formatoFecha, formatoRut, formatoTelefono, rutValido } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import {
  useAdultosResponsables,
  useCitas,
  useEquipoAgenda,
  useEstadoFichas,
  useEvoluciones,
  useFicha,
  usePaciente,
  useRespuestasMatch,
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
import { ContactoEmergencia, ConversacionesCaso, EvolucionesFicha } from './FichaClinica';
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

type Vista = 'sesiones' | 'evoluciones' | 'ingreso' | 'documentos' | 'cobros' | 'consentimientos' | 'datos';
/** Secciones de la antigua pagina /ficha (enlaces guardados). */
const ALIAS: Record<string, Vista> = { adjuntos: 'documentos', accesos: 'datos', alta: 'datos' };

/**
 * Vista del paciente (03b-4.2): pagina y ficha unificadas segun el rol
 * activo, sin el paso intermedio "Abrir ficha clinica".
 * - Encabezado de identidad fijo al hacer scroll (prevencion de errores):
 *   nombre, edad, RUT, sesiones, estado y tratante; datos rapidos; avisos
 *   de accion; acciones principales siempre visibles.
 * - Equipo con acceso clinico (tratante o acceso temporal): Sesiones,
 *   Evoluciones, Ingreso, Documentos y adjuntos, Cobros, Consentimientos y
 *   Datos, con panel lateral (motivo de consulta y ultima evolucion).
 * - ADMIN/GESTION: Sesiones (estado administrativo), Cobros,
 *   Consentimientos y Datos. Nunca contenido clinico.
 * Toda lectura clinica pasa por los mismos endpoints (accesos_ficha).
 */
export function DetallePaciente({ id, rol }: { id: string; rol: Rol }) {
  const consulta = usePaciente(id);
  return (
    <EstadoConsulta consulta={consulta}>
      {(p) => (
        <>
          <EnlaceVolver href="/admin/fichas">Volver al listado</EnlaceVolver>
          <VistaPaciente paciente={p} rol={rol} />
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

  const pestanas: { valor: Vista; etiqueta: string }[] = [
    { valor: 'sesiones', etiqueta: 'Sesiones' },
    ...(clinico
      ? ([
          { valor: 'evoluciones', etiqueta: 'Evoluciones' },
          { valor: 'ingreso', etiqueta: 'Ingreso' },
          { valor: 'documentos', etiqueta: 'Documentos y adjuntos' },
        ] as const)
      : []),
    ...(conCobros ? [{ valor: 'cobros' as const, etiqueta: 'Cobros' }] : []),
    { valor: 'consentimientos', etiqueta: 'Consentimientos' },
    { valor: 'datos', etiqueta: 'Datos' },
  ];
  const pedida = parametros.get('vista') ?? '';
  const vista: Vista = pestanas.find((t) => t.valor === (ALIAS[pedida] ?? pedida))?.valor ?? 'sesiones';
  const ir = (v: Vista, extra = '') => router.replace(`/admin/fichas/${p.id}?vista=${v}${extra}`, { scroll: false });

  return (
    <>
      <EncabezadoPaciente
        paciente={p}
        rol={rol}
        clinico={clinico}
        tratante={tratante}
        fichaId={ficha.data?.id}
        conCobros={conCobros}
        onVista={ir}
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
            <Button variant="secondary" icon="edit" onClick={() => setEditar(true)}>
              Editar datos
            </Button>
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

      <div className={`grid items-start gap-4 ${clinico && ficha.data ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
        <div className="flex min-w-0 flex-col gap-4">
          <Pestanas etiqueta="Secciones del paciente" tono="team" valor={vista} onChange={(v) => ir(v)} pestanas={pestanas} panelId="seccion-paciente" />
          <div id="seccion-paciente" role="tabpanel" className="entrada flex flex-col gap-4" key={vista}>
            {vista === 'sesiones' && (
              <>
                <DerivacionRecibida pacienteId={p.id} habilitado={rol === 'ADMIN' || tratante} />
                <HistorialSesiones paciente={p} rol={rol} tratante={tratante} />
              </>
            )}
            {vista === 'evoluciones' &&
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
            {vista === 'ingreso' &&
              (ficha.data ? <IngresoFicha fichaId={ficha.data.id} miId={cuenta.data?.id} /> : <AccesoFicha paciente={p} rol={rol} tratante={tratante} />)}
            {vista === 'documentos' && (
              <>
                <ExportacionClinicaPendiente pacienteId={p.id} tratante={tratante && rol === 'PROFESIONAL'} />
                <SolicitudesEpicrisis pacienteId={p.id} puedeResolver />
                <DocumentosFicha pacienteId={p.id} />
                <AdjuntosFicha pacienteId={p.id} />
              </>
            )}
            {vista === 'cobros' && <CobrosPaciente pacienteId={p.id} />}
            {vista === 'consentimientos' && <ConsentimientoPaciente paciente={p} rol={rol} />}
            {vista === 'datos' && (
              <>
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
              </>
            )}
          </div>
        </div>
        {clinico && ficha.data && (
          <aside aria-label="Resumen clínico" className="flex min-w-0 flex-col gap-4">
            <ResumenClinico pacienteId={p.id} fichaId={ficha.data.id} onVista={ir} />
            <ContactoEmergencia paciente={p} />
            <ConversacionesCaso pacienteId={p.id} />
          </aside>
        )}
      </div>
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

/** Modalidad mas frecuente de sus sesiones (nula sin sesiones). */
const modalidadHabitual = (citas: CitaVista[]) => {
  const online = citas.filter((c) => c.modalidad === 'ONLINE').length;
  return citas.length === 0 ? null : online * 2 > citas.length ? 'ONLINE' : 'PRESENCIAL';
};

/**
 * Encabezado de identidad fijo (CENS, prevencion de errores de paciente):
 * siempre a la vista al hacer scroll, con datos rapidos, avisos de accion y
 * las acciones principales.
 */
function EncabezadoPaciente({
  paciente: p,
  rol,
  clinico,
  tratante,
  fichaId,
  conCobros,
  onVista,
  acciones,
}: {
  paciente: PacienteVista;
  rol: Rol;
  clinico: boolean;
  tratante: boolean;
  fichaId?: string;
  conCobros: boolean;
  onVista: (v: Vista, extra?: string) => void;
  acciones: ReactNode;
}) {
  const admin = esAdministracion(rol);
  const edad = edadEn(p.fechaNacimiento);
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
  const realizadas = lista.filter((c) => c.estado === 'CONFIRMADA' && new Date(c.fin).getTime() <= ahora).length;
  const habitual = modalidadHabitual(lista.filter((c) => c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO'));
  const vigentes = (tarifas.data ?? []).filter((t) => new Date(t.vigenteDesde).getTime() <= ahora).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  // La mas especifica: tipo y modalidad, solo tipo, solo modalidad, general.
  const tarifa =
    vigentes.find((t) => t.tipoAtencionId === p.tipoAtencionId && t.modalidad === habitual) ??
    vigentes.find((t) => t.tipoAtencionId === p.tipoAtencionId && !t.modalidad) ??
    vigentes.find((t) => !t.tipoAtencionId && t.modalidad === habitual) ??
    vigentes.find((t) => !t.tipoAtencionId && !t.modalidad);
  const tratanteNombre = equipo.data?.find((m) => m.id === p.profesionalId)?.nombre;
  const tipo = tipos.data?.find((t) => t.id === p.tipoAtencionId)?.nombre;

  const sinEvolucion = clinico ? (estado?.sesiones_sin_cerrar ?? 0) : 0;
  const porPagar = conCobros
    ? (pagos.data ?? []).filter((c) => c.saldo > 0 && c.estado_cita !== 'CANCELADA').length
    : lista.filter((c) => c.estado === 'PENDIENTE_PAGO').length;
  const avisos: { icono: Icono; texto: string; ir: () => void }[] = [
    ...(consentimiento.vigente.data && !consentimiento.alDia && consentimiento.aceptaciones.isSuccess
      ? [{ icono: 'verified_user' as Icono, texto: 'Consentimiento pendiente', ir: () => onVista('consentimientos') }]
      : []),
    ...(sinEvolucion > 0
      ? [
          {
            icono: 'edit_note' as Icono,
            texto: sinEvolucion === 1 ? '1 sesión sin evolución' : `${sinEvolucion} sesiones sin evolución`,
            ir: () => onVista('evoluciones', '&nueva=1'),
          },
        ]
      : []),
    ...(porPagar > 0
      ? [
          {
            icono: 'payments' as Icono,
            texto: porPagar === 1 ? 'Pago pendiente' : `${porPagar} pagos pendientes`,
            ir: () => onVista(conCobros ? 'cobros' : 'sesiones'),
          },
        ]
      : []),
    ...((borradores.data?.length ?? 0) > 0
      ? [
          {
            icono: 'draft' as Icono,
            texto: borradores.data!.length === 1 ? 'Borrador sin confirmar' : `${borradores.data!.length} borradores sin confirmar`,
            ir: () => onVista('evoluciones'),
          },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-[5] -mx-2 mb-4 rounded-b-lg bg-neutral-300/95 px-2 pt-2 pb-3 backdrop-blur-sm" aria-label="Identidad del paciente">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-[clamp(24px,2.6vw,32px)] leading-[1.05] font-black tracking-[-0.03em]">
              {p.nombre} {p.apellido}
            </h1>
            {edad < 18 && <Badge tono="atencion">Menor de edad</Badge>}
            {estado && <Badge tono={estado.alta_en ? 'neutro' : 'positivo'}>{estado.alta_en ? `Alta ${formatoFecha(estado.alta_en)}` : 'Activo'}</Badge>}
            {p.traidoPorCentro && <Badge>Llegó por el centro</Badge>}
          </div>
          <p className="m-0 mt-1 text-[13.5px] font-semibold text-neutral-800">
            {edad} años · {p.rut ? `RUT ${formatoRut(p.rut)}` : 'Sin RUT'} · {realizadas === 1 ? '1 sesión' : `${realizadas} sesiones`}
            {tipo ? ` · ${tipo}` : ''}
            {` · Tratante: ${tratanteNombre ?? (p.profesionalId ? 'profesional del centro' : 'sin asignar')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">{acciones}</div>
      </div>

      <dl className="m-0 mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {p.email && <DatoRapido etiqueta="Correo" valor={p.email} copiar />}
        {p.telefono && <DatoRapido etiqueta="Teléfono" valor={formatoTelefono(p.telefono)} copiar={p.telefono} />}
        {habitual && <DatoRapido etiqueta="Modalidad habitual" valor={habitual === 'ONLINE' ? 'Online' : 'Presencial'} />}
        {tarifa && <DatoRapido etiqueta="Tarifa vigente" valor={formatoClp(tarifa.monto)} />}
        {edad < 18 && (
          <DatoRapido
            etiqueta="Adulto responsable"
            valor={(adultos.data ?? []).map((a) => `${a.nombre}${a.parentesco ? ` (${a.parentesco})` : ''}`).join(', ') || 'Falta registrarlo'}
          />
        )}
        {p.contactoEmergencia && <DatoRapido etiqueta="Emergencia" valor={p.contactoEmergencia.split('\n')[0]!} />}
      </dl>

      {avisos.length > 0 && (
        <ul aria-label="Avisos de acción" className="m-0 mt-2.5 flex list-none flex-wrap gap-2 p-0">
          {avisos.map((a) => (
            <li key={a.texto}>
              <button
                type="button"
                onClick={a.ir}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-accent-500 bg-accent-100 px-3 text-[12.5px] font-extrabold text-accent-800 hover:bg-accent-200 focus-visible:outline-2 focus-visible:outline-accent-700"
              >
                <Icon name={a.icono} size={16} />
                {a.texto}
                <Icon name="chevron_right" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

/** Dato del encabezado; `copiar` (true o el valor en bruto) agrega el boton de copiar. */
function DatoRapido({ etiqueta, valor, copiar }: { etiqueta: string; valor: string; copiar?: boolean | string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">{etiqueta}</dt>
      <dd className="m-0 max-w-[280px] truncate font-bold">{valor}</dd>
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
          className="grid size-8 cursor-pointer place-items-center rounded-full text-neutral-700 hover:bg-accent-100 hover:text-accent-700"
        >
          <Icon name={copiado ? 'check' : 'content_copy'} size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * Panel lateral del tratante: motivo de consulta (ficha de ingreso; sin ella,
 * lo que el paciente escribio al pedir hora) y ultima evolucion resumida.
 * Lecturas auditadas por la API.
 */
function ResumenClinico({ pacienteId, fichaId, onVista }: { pacienteId: string; fichaId: string; onVista: (v: Vista) => void }) {
  const ingresos = useIngresos(fichaId);
  const solicitud = useRespuestasMatch(pacienteId, true).data?.[0]?.respuestas as Record<string, unknown> | undefined;
  const escrito = solicitud?.motivo_sesion ?? solicitud?.relato;
  const evoluciones = useEvoluciones(fichaId, true);
  const ingreso = [...(ingresos.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const motivo = ingreso ? Object.entries(ingreso.valores ?? {}).find(([k, v]) => /motivo/i.test(k) && typeof v === 'string' && v.trim())?.[1] : undefined;
  const ultima = [...(evoluciones.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return (
    <Panel titulo="Resumen clínico" nivel={2}>
      <div className="flex flex-col gap-3">
        <div>
          <p className="m-0 text-xs font-extrabold text-neutral-700">Motivo de consulta</p>
          <p className="m-0 line-clamp-4 text-[14px] font-semibold whitespace-pre-line">
            {ingresos.isPending
              ? '…'
              : typeof motivo === 'string'
                ? motivo
                : typeof escrito === 'string'
                  ? `Al pedir hora: «${escrito}»`
                  : 'Sin ficha de ingreso registrada.'}
          </p>
        </div>
        <div className="border-t border-divider pt-3">
          <p className="m-0 text-xs font-extrabold text-neutral-700">Última evolución{ultima ? ` · ${formatoFecha(ultima.createdAt)}` : ''}</p>
          <p className="m-0 line-clamp-4 text-[14px] font-semibold whitespace-pre-line">
            {evoluciones.isPending ? '…' : (ultima?.notas ?? 'Todavía no hay evoluciones.')}
          </p>
          {ultima && (
            <button
              type="button"
              onClick={() => onVista('evoluciones')}
              className="mt-1.5 cursor-pointer text-[12.5px] font-extrabold text-accent-700 hover:underline"
            >
              Ver evoluciones
            </button>
          )}
        </div>
      </div>
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
