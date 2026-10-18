'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useProfesionales } from '@/lib/consultas';
import { formatoFecha, formatoFechaHora, formatoFechaLarga, formatoHora, formatoTelefono } from '@/lib/formato';
import {
  useAceptaciones,
  useAdultosResponsables,
  useCitas,
  useDerivaciones,
  useEspacios,
  useEvoluciones,
  useFicha,
  useRespuestasMatch,
  type CitaVista,
  type PacienteVista,
} from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

/** Ficha clinica: el tratante la abre; ADMIN ve solo la metadata (nunca las evoluciones); GESTION nada clinico. */
export function AccesoFicha({ paciente, rol, tratante }: { paciente: PacienteVista; rol: Rol; tratante: boolean }) {
  const puede = rol === 'ADMIN' || tratante;
  const ficha = useFicha(paciente.id, puede);
  const cliente = useQueryClient();
  const abrir = useMutation({
    mutationFn: () => datos(api.POST('/api/pacientes/{id}/ficha', { params: { path: { id: paciente.id } } })),
    onSuccess: (f) => cliente.setQueryData(['panel', 'paciente', paciente.id, 'ficha'], f),
  });
  if (!puede) {
    return (
      <Panel titulo="Ficha clínica">
        <Aviso tono="nota">La ficha clínica la ven solo su profesional tratante y quien tenga un acceso clínico temporal vigente.</Aviso>
      </Panel>
    );
  }
  const sinFicha = ficha.error instanceof ApiError && ficha.error.status === 404;
  return (
    <Panel titulo="Ficha clínica" variante={tratante ? 'equipo' : 'claro'}>
      {ficha.isPending ? (
        <span aria-hidden="true" className="esqueleto block h-12 rounded-lg" />
      ) : sinFicha ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Este paciente todavía no tiene ficha abierta.</p>
          {(rol === 'ADMIN' || rol === 'PROFESIONAL') && (
            <div>
              <Button variant="team" icon="folder_open" loading={abrir.isPending} onClick={() => abrir.mutate()}>
                Abrir ficha
              </Button>
            </div>
          )}
        </div>
      ) : ficha.data ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
            Abierta el {formatoFecha(ficha.data.fechaApertura)}. Se conserva al menos 15 años desde la última atención.
          </p>
          {tratante ? (
            <div>
              <ButtonLink href={`/admin/fichas/${paciente.id}/ficha`} variant="team" icon="edit_note">
                Abrir ficha clínica
              </ButtonLink>
            </div>
          ) : (
            <Aviso tono="nota" icono="shield_person">
              Desde administración ves que la ficha existe, nunca su contenido (secreto profesional).
            </Aviso>
          )}
        </div>
      ) : (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          No pudimos cargar la ficha.
        </p>
      )}
    </Panel>
  );
}

/** C-4: la derivacion traspasa la ficha; el origen deja de verla. */
export function DerivacionRecibida({ pacienteId, habilitado }: { pacienteId: string; habilitado: boolean }) {
  const ficha = useFicha(pacienteId, habilitado);
  const derivaciones = useDerivaciones(habilitado && !!ficha.data);
  const profesionales = useProfesionales(habilitado);
  const recibida = derivaciones.data?.find((d) => d.fichaClinicaId === ficha.data?.id && d.estado === 'ACEPTADA');
  if (!recibida) return null;
  const origen = profesionales.data?.find((p) => p.id === recibida.profesionalOrigenId)?.nombre ?? 'otro profesional del centro';
  return (
    <Aviso tono="info" icono="call_split" titulo={`Llegó por derivación desde ${origen}`}>
      Derivado el {formatoFecha(recibida.fecha)}. La derivación traspasa la ficha: el profesional de origen ya no la ve. Para coordinar con otro profesional sin
      traspasar, se usa un acceso clínico temporal (interconsulta).
    </Aviso>
  );
}

/** Lo que respondio en el match al pedir hora (solo el tratante; ADMIN y GESTION nunca). */
export function IndicacionesPaciente({ pacienteId }: { pacienteId: string }) {
  const respuestas = useRespuestasMatch(pacienteId, true);
  const cuestionario = useQuery({ queryKey: ['publico', 'cuestionario'], queryFn: () => datos(api.GET('/api/publico/cuestionario')), staleTime: 10 * 60_000 });
  const ultima = respuestas.data?.[0];
  return (
    <Panel titulo="Indicaciones del paciente" bajada="Lo que respondió en el cuestionario al pedir su primera hora. Solo lo ves tú.">
      <EstadoConsulta consulta={respuestas}>
        {() => {
          if (!ultima)
            return <p className="m-0 text-[13.5px] font-semibold text-neutral-700">No llegó por el cuestionario del sitio: no hay respuestas guardadas.</p>;
          const r = (ultima.respuestas ?? {}) as Record<string, unknown>;
          const preguntas = cuestionario.data?.preguntas ?? [];
          const texto = (clave: string, valor: unknown) => {
            const p = preguntas.find((q) => q.clave === clave);
            const etiqueta = (v: unknown) => p?.opciones.find((o) => o.valor === v)?.etiqueta ?? String(v);
            return { pregunta: p?.texto ?? clave, valor: Array.isArray(valor) ? valor.map(etiqueta).join(', ') : etiqueta(valor) };
          };
          return (
            <dl className="m-0 grid gap-3.5">
              {Object.entries(r).map(([k, v]) => {
                const t = texto(k, v);
                return (
                  <div key={k}>
                    <dt className="text-xs font-extrabold text-neutral-700">{t.pregunta}</dt>
                    <dd className="m-0 text-[14.5px] font-semibold whitespace-pre-line text-pretty">{t.valor}</dd>
                  </div>
                );
              })}
              <p className="m-0 text-xs font-semibold text-neutral-700">Respondido el {formatoFechaLarga(ultima.creadaEn)}.</p>
            </dl>
          );
        }}
      </EstadoConsulta>
    </Panel>
  );
}

const diaCorto = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short' });

const ESTADO_CITA: Record<CitaVista['estado'], { texto: string; tono: TonoBadge }> = {
  CONFIRMADA: { texto: 'Confirmada', tono: 'positivo' },
  SOLICITADA: { texto: 'Por aprobar', tono: 'atencion' },
  POR_REPROGRAMAR: { texto: 'Por reprogramar', tono: 'atencion' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutro' },
};

/** Historial de sesiones (metadata). El tratante ve que sesiones ya tienen evolucion y registra las pendientes. */
export function HistorialSesiones({ paciente, rol, tratante }: { paciente: PacienteVista; rol: Rol; tratante: boolean }) {
  const citas = useCitas({ pacienteId: paciente.id });
  const espacios = useEspacios();
  const profesionales = useProfesionales(true);
  const clinico = (rol === 'PROFESIONAL' || rol === 'PRACTICANTE') && tratante;
  const ficha = useFicha(paciente.id, clinico);
  const evoluciones = useEvoluciones(ficha.data?.id, clinico);
  const cerradas = new Set((evoluciones.data ?? []).map((e) => e.citaId).filter(Boolean));
  const boxes = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const equipo = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const ahora = Date.now();
  const lista = [...(citas.data ?? [])].sort((a, b) => b.inicio.localeCompare(a.inicio));
  const realizadas = lista.filter((c) => c.estado === 'CONFIRMADA' && new Date(c.fin).getTime() <= ahora).length;

  return (
    <Panel
      titulo="Historial de sesiones"
      accion={<span className="text-[12.5px] font-bold text-neutral-700">{realizadas === 1 ? '1 sesión realizada' : `${realizadas} sesiones realizadas`}</span>}
    >
      <EstadoConsulta consulta={citas} vacio={() => lista.length === 0} textoVacio="Sin sesiones todavía">
        {() => (
          <ul className="m-0 flex list-none flex-col p-0">
            {lista.map((c) => {
              const pasada = new Date(c.fin).getTime() <= ahora;
              const realizada = pasada && c.estado === 'CONFIRMADA';
              const conEvolucion = cerradas.has(c.id);
              const estado = realizada
                ? clinico
                  ? conEvolucion
                    ? { texto: 'Evolución registrada', tono: 'neutro' as const }
                    : { texto: 'Sin evolución', tono: 'atencion' as const }
                  : { texto: 'Realizada', tono: 'neutro' as const }
                : ESTADO_CITA[c.estado];
              return (
                <li key={c.id} id={`cita-${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider py-3 last:border-b-0">
                  <span className="w-[64px] flex-none text-[13px] font-black tabular-nums">
                    {diaCorto.format(new Date(c.inicio))}
                    <span className="block text-xs font-bold text-neutral-700">{formatoHora(c.inicio)}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-[30px] w-[3px] flex-none rounded-full ${c.modalidad === 'ONLINE' ? 'bg-accent-2-600' : 'bg-accent-600'}`}
                  />
                  <div className="min-w-0 flex-[1_1_160px]">
                    <p className="m-0 text-[14px] font-extrabold">
                      {c.modalidad === 'ONLINE' ? 'Online' : `Presencial${c.espacioId ? ` · ${boxes.get(c.espacioId) ?? 'Box'}` : ''}`}
                    </p>
                    <p className="m-0 text-[12.5px] font-semibold text-neutral-700">{equipo.get(c.profesionalId) ?? 'Profesional del centro'}</p>
                  </div>
                  <Badge tono={estado.tono}>{estado.texto}</Badge>
                  {clinico && realizada && !conEvolucion && (
                    <ButtonLink href={`/admin/fichas/${paciente.id}/ficha?cita=${c.id}`} variant="team" icon="edit_note" className="!px-4 !py-2 !text-[13px]">
                      Registrar evolución
                    </ButtonLink>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </EstadoConsulta>
      {!clinico && (
        <p className="m-0 mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
          <Icon name="lock" size={16} />
          Solo datos administrativos de las horas: el contenido de las sesiones es del profesional tratante.
        </p>
      )}
    </Panel>
  );
}

/** Adultos responsables (exigidos para agendar a un menor) y contacto de emergencia. */
export function AdultosResponsables({ paciente }: { paciente: PacienteVista }) {
  const adultos = useAdultosResponsables(paciente.id);
  const [agregar, setAgregar] = useState(false);
  const menor = edadEn(paciente.fechaNacimiento) < 18;
  return (
    <Panel
      titulo="Adulto responsable"
      accion={
        <button
          type="button"
          onClick={() => setAgregar(true)}
          className="flex min-h-10 cursor-pointer items-center gap-1.5 text-[13px] font-extrabold text-accent-700 hover:text-accent-800"
        >
          <Icon name="add" size={17} />
          Agregar
        </button>
      }
    >
      <EstadoConsulta consulta={adultos}>
        {(lista) => (
          <div className="flex flex-col gap-3.5">
            {lista.length === 0 ? (
              menor ? (
                <Aviso tono="advertencia" icono="family_restroom">
                  Es menor de edad y no tiene adulto responsable: no se le puede agendar hasta registrarlo.
                </Aviso>
              ) : (
                <p className="m-0 text-[13.5px] font-semibold text-neutral-700">No tiene adulto responsable registrado (no es obligatorio para un adulto).</p>
              )
            ) : (
              lista.map((a) => (
                <div key={a.id} className="flex flex-col gap-0.5 border-b border-divider pb-3 last:border-b-0 last:pb-0">
                  <p className="m-0 text-[14.5px] font-extrabold">
                    {a.nombre}
                    {a.parentesco ? <span className="font-semibold text-neutral-700"> · {a.parentesco}</span> : null}
                  </p>
                  <p className="m-0 text-[13px] font-semibold text-neutral-800">
                    {[a.telefono && formatoTelefono(a.telefono), a.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                  </p>
                </div>
              ))
            )}
            <div className="border-t border-divider pt-3">
              <p className="m-0 text-xs font-extrabold text-neutral-700">Contacto de emergencia</p>
              <p className="m-0 text-[14px] font-semibold">{paciente.contactoEmergencia ?? 'Sin registrar'}</p>
            </div>
          </div>
        )}
      </EstadoConsulta>
      <Modal abierto={agregar} onCerrar={() => setAgregar(false)} titulo="Agregar adulto responsable">
        {agregar && <FormularioAdulto pacienteId={paciente.id} onListo={() => setAgregar(false)} />}
      </Modal>
    </Panel>
  );
}

function FormularioAdulto({ pacienteId, onListo }: { pacienteId: string; onListo: () => void }) {
  const cliente = useQueryClient();
  const [d, setD] = useState({ nombre: '', parentesco: '', telefono: '', email: '' });
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/pacientes/{id}/adultos-responsables', {
          params: { path: { id: pacienteId } },
          body: {
            nombre: d.nombre.trim(),
            parentesco: d.parentesco.trim() || undefined,
            telefono: d.telefono.replace(/[\s()-]/g, '') || undefined,
            email: d.email.trim().toLowerCase() || undefined,
          },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'paciente', pacienteId, 'adultos'] });
      onListo();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos registrar al adulto responsable.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!d.nombre.trim()) return setError('Escribe el nombre.');
    if (d.telefono && !/^\+56\d{9}$/.test(d.telefono.replace(/[\s()-]/g, ''))) return setError('Teléfono con código de país: +56 9 1234 5678.');
    setError(undefined);
    crear.mutate();
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <Field label="Nombre" required>
        {(p) => <Input {...p} value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} />}
      </Field>
      <Field label="Relación con el paciente">
        {(p) => <Input {...p} placeholder="Madre, padre, tutor…" value={d.parentesco} onChange={(e) => setD({ ...d, parentesco: e.target.value })} />}
      </Field>
      <Field label="Teléfono">{(p) => <Input {...p} type="tel" value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} />}</Field>
      <Field label="Correo" hint="Recibe los avisos, consentimientos y la invitación a la cuenta del menor.">
        {(p) => <Input {...p} type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />}
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
        <Button type="submit" variant="team" icon="save" loading={crear.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

/**
 * Consentimiento informado de atencion: version aceptada vs vigente.
 * ADMIN/GESTION lo envian por correo (enlace de un solo uso) o lo registran
 * firmado en el centro con respaldo. Un menor lo otorga su adulto responsable.
 */
export function ConsentimientoPaciente({ paciente, rol }: { paciente: PacienteVista; rol: Rol }) {
  const admin = esAdministracion(rol);
  const aceptaciones = useAceptaciones(paciente.id);
  const vigente = useQuery({
    queryKey: ['publico', 'politica', 'CONSENTIMIENTO_ATENCION'],
    queryFn: () => datos(api.GET('/api/publico/politicas/{tipo}', { params: { path: { tipo: 'CONSENTIMIENTO_ATENCION' } } })),
    retry: false,
  });
  const adultos = useAdultosResponsables(paciente.id);
  const cliente = useQueryClient();
  const [registrar, setRegistrar] = useState(false);
  const [respaldo, setRespaldo] = useState('');
  const [adultoId, setAdultoId] = useState('');
  const [aviso, setAviso] = useState<string>();
  const menor = edadEn(paciente.fechaNacimiento) < 18;
  const enlace = useMutation({
    mutationFn: () => datos(api.POST('/api/pacientes/{id}/consentimiento-atencion/enlace', { params: { path: { id: paciente.id } } })),
    onSuccess: (r) => setAviso(`Enviamos el enlace por correo${menor ? ' al adulto responsable' : ''}. Vence el ${formatoFechaHora(r.venceEn)}.`),
  });
  const presencial = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/pacientes/{id}/consentimiento-atencion', {
          params: { path: { id: paciente.id } },
          body: { respaldoRef: respaldo.trim(), adultoResponsableId: menor ? adultoId || undefined : undefined },
        }),
      ),
    onSuccess: () => {
      setRegistrar(false);
      setRespaldo('');
      void cliente.invalidateQueries({ queryKey: ['panel', 'paciente', paciente.id, 'aceptaciones'] });
    },
  });
  const ultima = aceptaciones.data?.find((a) => a.politica.tipo === 'CONSENTIMIENTO_ATENCION');
  const alDia = !!ultima && (!vigente.data || ultima.politica.version >= vigente.data.version);
  return (
    <Panel titulo="Consentimiento informado">
      <EstadoConsulta consulta={aceptaciones}>
        {() => (
          <div className="flex flex-col gap-3">
            <p className="m-0 flex items-center gap-2 text-[14.5px] font-extrabold">
              <Icon name={alDia ? 'task_alt' : 'pending'} size={19} className={alDia ? 'text-accent-2-700' : 'text-accent-700'} />
              {alDia ? 'Firmado' : ultima ? 'Hay una versión nueva por aceptar' : 'Pendiente'}
            </p>
            <p className="m-0 text-[13px] font-semibold text-neutral-700">
              {ultima
                ? `Versión ${ultima.politica.version}, ${formatoFecha(ultima.aceptadaEn)} (${CANAL[ultima.canal]}${ultima.otorgadoPor === 'ADULTO_RESPONSABLE' ? ', por su adulto responsable' : ''}).`
                : vigente.data
                  ? `Versión vigente ${vigente.data.version}. ${menor ? 'Lo otorga su adulto responsable.' : 'Lo acepta el paciente.'}`
                  : 'El centro todavía no publica su consentimiento informado (Configuración).'}
            </p>
            {aviso && (
              <Aviso tono="exito" role="status">
                {aviso}
              </Aviso>
            )}
            {(enlace.error || presencial.error) && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {(enlace.error ?? presencial.error) instanceof ApiError ? (enlace.error ?? presencial.error)!.message : 'No pudimos completar la acción.'}
              </p>
            )}
            {admin && !alDia && vigente.data ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="team" icon="mail" loading={enlace.isPending} onClick={() => enlace.mutate()} className="!py-2.5">
                  Enviar enlace por correo
                </Button>
                <Button variant="secondary" icon="edit_note" onClick={() => setRegistrar(true)} className="!py-2.5">
                  Registrar firmado en el centro
                </Button>
              </div>
            ) : (
              !admin &&
              !alDia && <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Recepción lo envía por correo o lo registra firmado en el centro.</p>
            )}
          </div>
        )}
      </EstadoConsulta>
      <Modal
        abierto={registrar}
        onCerrar={() => setRegistrar(false)}
        titulo="Registrar consentimiento firmado"
        descripcion="Úsalo solo si el documento se firmó en papel en el centro. Indica dónde queda el respaldo (por ejemplo, el archivo escaneado)."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setRegistrar(false)}>
              Cancelar
            </Button>
            <Button
              variant="team"
              loading={presencial.isPending}
              disabled={respaldo.trim().length < 3 || (menor && !adultoId)}
              onClick={() => presencial.mutate()}
            >
              Registrar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Respaldo del documento" required hint="Ej.: Escaneado en carpeta Consentimientos/2026, folio 112.">
            {(p) => <Input {...p} value={respaldo} onChange={(e) => setRespaldo(e.target.value)} />}
          </Field>
          {menor && (
            <Field label="Firmado por" required>
              {(p) => (
                <Select {...p} value={adultoId} onChange={(e) => setAdultoId(e.target.value)}>
                  <option value="">Elige al adulto responsable</option>
                  {adultos.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                      {a.parentesco ? ` (${a.parentesco})` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      </Modal>
    </Panel>
  );
}

const CANAL: Record<'SOLICITUD' | 'PORTAL' | 'TOKEN' | 'PRESENCIAL', string> = {
  SOLICITUD: 'al pedir hora',
  PORTAL: 'en su cuenta',
  TOKEN: 'por enlace del correo',
  PRESENCIAL: 'firmado en el centro',
};

/** Cuenta del portal: invitacion al paciente (desde la edad minima) o a su adulto responsable. Solo administracion. */
export function CuentaPaciente({ paciente }: { paciente: PacienteVista }) {
  const adultos = useAdultosResponsables(paciente.id);
  const [destino, setDestino] = useState('');
  const [resultado, setResultado] = useState<string>();
  const menor = edadEn(paciente.fechaNacimiento) < 18;
  const invitar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/pacientes/{id}/invitacion', {
          params: { path: { id: paciente.id } },
          body: elegido && elegido !== 'paciente' ? { adultoResponsableId: elegido } : {},
        }),
      ),
    onSuccess: (r) => setResultado(`Invitación enviada. El enlace vence el ${formatoFechaHora(r.invitacionVence)}.`),
  });
  const opciones = [
    ...(paciente.email ? [{ id: 'paciente', nombre: `${paciente.nombre} (${paciente.email})` }] : []),
    ...(menor ? (adultos.data ?? []).filter((a) => a.email).map((a) => ({ id: a.id, nombre: `${a.nombre}, adulto responsable (${a.email})` })) : []),
  ];
  const elegido = destino || opciones[0]?.id;
  return (
    <Panel titulo="Cuenta del portal" bajada="Con cuenta, el paciente ve sus horas, pagos y documentos, y responde consentimientos.">
      <div className="flex flex-col gap-3">
        {resultado && (
          <Aviso tono="exito" role="status">
            {resultado}
          </Aviso>
        )}
        {opciones.length === 0 ? (
          <p className="m-0 text-[13px] font-semibold text-neutral-700">
            Para invitar, registra un correo del paciente{menor ? ' o de su adulto responsable' : ''}.
          </p>
        ) : (
          <>
            <Field label="Invitar a">
              {(p) => (
                <Select {...p} value={elegido} onChange={(e) => setDestino(e.target.value)}>
                  {opciones.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {invitar.error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {invitar.error instanceof ApiError ? invitar.error.message : 'No pudimos enviar la invitación.'}
              </p>
            )}
            <div>
              <Button variant="secondary" icon="send" loading={invitar.isPending} onClick={() => invitar.mutate()} className="!py-2.5">
                Enviar invitación
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
