'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFechaHora, formatoHora } from '@/lib/formato';
import { retirable, useHilos, useMensajesHilo, type Hilo } from '@/lib/mensajes';
import { nombresPacientes, usePacientes } from '@/lib/panel';
import { NOMBRE_ROL, esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

const MAX_MENSAJE = 4000;
const textoError = (e: unknown, base: string) => (e instanceof ApiError ? e.message : base);

/**
 * Mensajeria interna del equipo (03a-2). No es el expediente: una decision
 * clinica se registra en una evolucion.
 * - GENERAL: coordinacion con participantes explicitos; no se nombra a pacientes.
 * - CASO: vinculado a un paciente; lo ve quien tiene acceso clinico vigente y
 *   desaparece al perderlo. ADMIN y GESTION no participan de casos.
 * Sin edicion; el autor retira un mensaje dentro de 5 minutos. Polling.
 */
export function MensajeriaInterna({ rol, hiloInicial, nuevoCaso }: { rol: Rol; hiloInicial?: string; nuevoCaso?: string }) {
  const hilos = useHilos();
  const pacientes = usePacientes();
  const nombrePaciente = nombresPacientes(pacientes.data);
  const [abierto, setAbierto] = useState<string | null>(hiloInicial ?? null);
  const [nuevo, setNuevo] = useState(!!nuevoCaso);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section aria-label="Conversaciones" className="flex min-w-0 flex-col gap-3">
        <Button variant="team" icon="add" onClick={() => setNuevo(true)} className="self-start">
          Nueva conversación
        </Button>
        <EstadoConsulta consulta={hilos} vacio={(l) => l.length === 0} textoVacio="Sin conversaciones todavía">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {lista.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    aria-pressed={abierto === h.id}
                    onClick={() => setAbierto(h.id)}
                    className={`flex min-h-14 w-full cursor-pointer items-start justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left transition-colors duration-200 ease-out ${abierto === h.id ? 'bg-accent-200' : 'hover:bg-accent-100'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-extrabold">{h.asunto ?? 'Conversación'}</span>
                      <span className="block text-[12px] font-semibold text-neutral-800">
                        {h.tipo === 'CASO' ? `Caso · ${h.pacienteId ? (nombrePaciente.get(h.pacienteId) ?? 'paciente') : 'paciente'}` : 'General'} ·{' '}
                        {formatoFechaHora(h.ultimoMensajeEn)}
                      </span>
                    </span>
                    {h.noLeidos > 0 && (
                      <span
                        className="flex-none rounded-full bg-accent-700 px-2 py-0.5 text-[11.5px] font-extrabold text-neutral-100"
                        aria-label={`${h.noLeidos} sin leer`}
                      >
                        {h.noLeidos}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </section>
      <div className="min-w-0">
        {abierto ? (
          <Conversacion id={abierto} hilo={hilos.data?.find((h) => h.id === abierto)} nombrePaciente={nombrePaciente} />
        ) : (
          <EstadoVista estado="vacio" titulo="Elige una conversación" mensaje="Los mensajes se actualizan solos cada pocos segundos." />
        )}
      </div>
      <Modal abierto={nuevo} onCerrar={() => setNuevo(false)} titulo="Nueva conversación">
        {nuevo && (
          <NuevaConversacion
            rol={rol}
            pacienteInicial={nuevoCaso}
            onListo={(id) => {
              setNuevo(false);
              if (id) setAbierto(id);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Conversacion({ id, hilo, nombrePaciente }: { id: string; hilo?: Hilo; nombrePaciente: Map<string, string> }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const mensajes = useMensajesHilo(id);
  const [texto, setTexto] = useState('');
  const [agregar, setAgregar] = useState(false);
  // Abrir el hilo registra la lectura: la lista recalcula los no leidos.
  useEffect(() => {
    if (mensajes.dataUpdatedAt) void cliente.invalidateQueries({ queryKey: ['hilos', 'todos'] });
  }, [mensajes.dataUpdatedAt, cliente]);
  const enviar = useMutation({
    mutationFn: () => datos(api.POST('/api/hilos/{id}/mensajes', { params: { path: { id } }, body: { contenido: texto.trim() } })),
    onSuccess: () => {
      setTexto('');
      void cliente.invalidateQueries({ queryKey: ['hilos'] });
    },
  });
  const retirar = useMutation({
    mutationFn: (mensajeId: string) => datos(api.POST('/api/hilos/mensajes/{mensajeId}/retiro', { params: { path: { mensajeId } } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['hilos', 'mensajes', id] }),
  });
  const mandar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim()) enviar.mutate();
  };
  return (
    <EstadoConsulta consulta={mensajes}>
      {(d) => {
        const general = d.hilo.tipo === 'GENERAL';
        const otros = d.lecturas.filter((l) => l.usuarioId !== cuenta.data?.id);
        return (
          <section
            aria-label={d.hilo.asunto ?? 'Conversación'}
            className="flex flex-col gap-3.5 rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4"
          >
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-divider pb-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[18px] font-black tracking-[-0.01em]">{d.hilo.asunto ?? 'Conversación'}</h2>
                <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                  {general
                    ? 'General: no se nombra a pacientes'
                    : `Caso de ${d.hilo.pacienteId ? (nombrePaciente.get(d.hilo.pacienteId) ?? 'un paciente') : 'un paciente'}: lo ve quien tiene acceso clínico`}
                </p>
              </div>
              {general && hilo && (
                <Button variant="ghost" icon="person_add" onClick={() => setAgregar(true)} className="!px-3.5 !py-2 !text-[13px]">
                  Agregar personas
                </Button>
              )}
            </header>
            {d.mensajes.length === 0 ? (
              <p className="m-0 text-[13.5px] font-semibold text-neutral-700">Todavía no hay mensajes.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {d.mensajes.map((m) => {
                  const mio = m.autorId === cuenta.data?.id;
                  return (
                    <li key={m.id} className={`max-w-[85%] rounded-lg px-3.5 py-2.5 ${mio ? 'self-end bg-accent-200' : 'self-start bg-bg'}`}>
                      <p className="m-0 text-[12px] font-extrabold text-neutral-800">
                        {mio ? 'Tú' : m.autor} · {NOMBRE_ROL[m.rolAutor]} · {formatoHora(m.creadoEn)}
                      </p>
                      {m.retirado ? (
                        <p className="m-0 text-[13.5px] font-semibold text-neutral-700 italic">Mensaje retirado</p>
                      ) : (
                        <p className="m-0 text-[14.5px] font-semibold whitespace-pre-line text-pretty">{m.contenido}</p>
                      )}
                      {mio && !m.retirado && retirable(m.creadoEn) && (
                        <button
                          type="button"
                          onClick={() => retirar.mutate(m.id)}
                          className="mt-1 min-h-8 cursor-pointer text-[12px] font-extrabold text-accent-700 hover:text-accent-800"
                        >
                          Retirar (hasta 5 minutos)
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {otros.length > 0 && (
              <p className="m-0 text-[12px] font-semibold text-neutral-700">
                Leído por {otros.map((l) => `${l.nombre} (${formatoFechaHora(l.leidoEn)})`).join(', ')}
              </p>
            )}
            {(enviar.error || retirar.error) && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {textoError(enviar.error ?? retirar.error, 'No pudimos completar la acción.')}
              </p>
            )}
            <form onSubmit={mandar} className="flex flex-col gap-2 border-t border-divider pt-3">
              <Field
                label="Mensaje"
                hint={general ? 'Sin nombres de pacientes en una conversación general.' : 'Las decisiones clínicas van en la evolución, no aquí.'}
              >
                {(p) => <Textarea {...p} rows={3} maxLength={MAX_MENSAJE} value={texto} onChange={(e) => setTexto(e.target.value)} className="!min-h-20" />}
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="team" icon="send" disabled={!texto.trim()} loading={enviar.isPending}>
                  Enviar
                </Button>
              </div>
            </form>
            <Modal abierto={agregar} onCerrar={() => setAgregar(false)} titulo="Agregar personas">
              {agregar && <AgregarParticipantes hiloId={id} onListo={() => setAgregar(false)} />}
            </Modal>
          </section>
        );
      }}
    </EstadoConsulta>
  );
}

/** Integrantes vigentes del equipo (directorio interno; nunca pacientes). */
function useDirectorioEquipo() {
  return useQuery({ queryKey: ['directorio', 'todos'], queryFn: () => datos(api.GET('/api/directorio')), staleTime: 5 * 60_000 });
}

function NuevaConversacion({ rol, pacienteInicial, onListo }: { rol: Rol; pacienteInicial?: string; onListo: (id?: string) => void }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const directorio = useDirectorioEquipo();
  const pacientes = usePacientes({}, !esAdministracion(rol));
  // ADMIN y GESTION no ven casos clinicos: solo conversaciones generales.
  const puedeCaso = !esAdministracion(rol);
  const [tipo, setTipo] = useState<'GENERAL' | 'CASO'>(pacienteInicial && puedeCaso ? 'CASO' : 'GENERAL');
  const [asunto, setAsunto] = useState('');
  const [pacienteId, setPacienteId] = useState(pacienteInicial ?? '');
  const [participantes, setParticipantes] = useState<string[]>([]);
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/hilos', {
          body: tipo === 'CASO' ? { tipo, asunto: asunto.trim(), pacienteId } : { tipo, asunto: asunto.trim(), participantes },
        }),
      ),
    onSuccess: (h) => {
      void cliente.invalidateQueries({ queryKey: ['hilos'] });
      onListo(h.id);
    },
  });
  const listo = asunto.trim().length > 0 && (tipo === 'CASO' ? !!pacienteId : participantes.length > 0);
  return (
    <div className="flex flex-col gap-4">
      {puedeCaso && (
        <ChoiceGroup
          legend="Tipo"
          type="radio"
          value={[tipo]}
          onChange={(v) => setTipo((v[0] as 'GENERAL' | 'CASO') ?? 'GENERAL')}
          options={[
            { value: 'GENERAL', label: 'General (coordinación, sin pacientes)' },
            { value: 'CASO', label: 'Caso de un paciente (lo ve quien tiene acceso clínico)' },
          ]}
        />
      )}
      {tipo === 'CASO' ? (
        <Field label="Paciente" required>
          {(p) => (
            <Select {...p} value={pacienteId} onChange={(e) => setPacienteId(e.target.value)}>
              <option value="">Elige un paciente</option>
              {(pacientes.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.apellido}, {x.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <>
          <Aviso tono="nota" icono="lock">
            En una conversación general no se nombra a pacientes. Para hablar de un caso, crea una conversación del caso.
          </Aviso>
          <ChoiceGroup
            legend="Participantes"
            type="checkbox"
            value={participantes}
            onChange={setParticipantes}
            options={(directorio.data ?? []).filter((m) => m.id !== cuenta.data?.id).map((m) => ({ value: m.id, label: m.nombre ?? 'Integrante' }))}
          />
        </>
      )}
      <Field label="Asunto" required>
        {(p) => <Input {...p} maxLength={200} value={asunto} onChange={(e) => setAsunto(e.target.value)} />}
      </Field>
      {crear.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(crear.error, 'No pudimos crear la conversación.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={() => onListo()}>
          Cancelar
        </Button>
        <Button variant="team" disabled={!listo} loading={crear.isPending} onClick={() => crear.mutate()}>
          Crear
        </Button>
      </div>
    </div>
  );
}

function AgregarParticipantes({ hiloId, onListo }: { hiloId: string; onListo: () => void }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const directorio = useDirectorioEquipo();
  const [elegidos, setElegidos] = useState<string[]>([]);
  const agregar = useMutation({
    mutationFn: () => datos(api.POST('/api/hilos/{id}/participantes', { params: { path: { id: hiloId } }, body: { participantes: elegidos } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['hilos', 'mensajes', hiloId] });
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] font-semibold text-neutral-800">Ven la conversación completa desde que se agregan.</p>
      <ChoiceGroup
        legend="Integrantes"
        type="checkbox"
        value={elegidos}
        onChange={setElegidos}
        options={(directorio.data ?? []).filter((m) => m.id !== cuenta.data?.id).map((m) => ({ value: m.id, label: m.nombre ?? 'Integrante' }))}
      />
      {agregar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(agregar.error, 'No pudimos agregar a las personas.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" disabled={elegidos.length === 0} loading={agregar.isPending} onClick={() => agregar.mutate()}>
          Agregar
        </Button>
      </div>
    </div>
  );
}

/** Insignia de no leidos para el menu o el encabezado (suma de todos los hilos). */
export function NoLeidosHilos() {
  const hilos = useHilos();
  const total = (hilos.data ?? []).reduce((s, h) => s + h.noLeidos, 0);
  return total > 0 ? <Badge tono="atencion">{total} sin leer</Badge> : null;
}
