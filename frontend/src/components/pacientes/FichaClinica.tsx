'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { NIVEL_RIESGO, useBorradores, useIngresos, type BorradorVista, type EvolucionVista } from '@/lib/fichas';
import { formatoFecha, formatoTelefono } from '@/lib/formato';
import { useHilos } from '@/lib/mensajes';
import { separarNotas } from '@/lib/notasEvolucion';
import { useAdultosResponsables, useCitas, useEvoluciones, useRespuestasMatch, type PacienteVista } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import dynamic from 'next/dynamic';

// 03b-6: el editor de evoluciones solo se descarga al escribir o corregir un registro.
const EditorEvolucion = dynamic(() => import('./EditorEvolucion').then((m) => m.EditorEvolucion), {
  loading: () => <EstadoVista estado="carga" titulo="Abriendo el editor…" />,
});
import { FichaClinicaTimeline } from './FichaClinicaTimeline';

/**
 * Piezas clinicas de la vista del paciente (03b-4.2: la ficha ya no es una
 * pagina aparte; vive en las pestañas de DetallePaciente para quien tiene
 * acceso). Solo el equipo tratante o un acceso clinico temporal vigente: la
 * RLS decide y cada lectura queda en accesos_ficha.
 */

/** Motivo de consulta: ficha de ingreso; sin ella, lo que el paciente escribio al pedir hora. */
export function useMotivoConsulta(pacienteId: string, fichaId: string) {
  const ingresos = useIngresos(fichaId);
  const solicitud = useRespuestasMatch(pacienteId, true).data?.[0]?.respuestas as Record<string, unknown> | undefined;
  const escrito = solicitud?.motivo_sesion ?? solicitud?.relato;
  const ingreso = [...(ingresos.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const motivo = ingreso ? Object.entries(ingreso.valores ?? {}).find(([k, v]) => /motivo/i.test(k) && typeof v === 'string' && v.trim())?.[1] : undefined;
  if (ingresos.isPending) return '…';
  if (typeof motivo === 'string') return motivo;
  return typeof escrito === 'string' ? `Al pedir hora: «${escrito}»` : 'Sin ficha de ingreso registrada.';
}

/** Evoluciones: editor con su contexto y archivo en pilas (borradores propios y expediente). */
export function EvolucionesFicha({
  fichaId,
  paciente,
  citaInicial,
  borradorInicial,
  nueva = false,
  rol,
}: {
  fichaId: string;
  paciente: PacienteVista;
  citaInicial?: string;
  borradorInicial?: string;
  /** 03b-4.2: "Registrar evolucion" del encabezado abre el editor al llegar. */
  nueva?: boolean;
  rol: Rol;
}) {
  const cuenta = useMiCuenta();
  const evoluciones = useEvoluciones(fichaId, true);
  const borradores = useBorradores(fichaId);
  const citas = useCitas({ pacienteId: paciente.id });
  const router = useRouter();
  const [editor, setEditor] = useState<{ borrador?: BorradorVista; corrige?: EvolucionVista; cita?: string } | null>(
    citaInicial || nueva ? { cita: citaInicial } : null,
  );
  // undefined = la pila del mes mas reciente; null = todas juntas.
  const [pila, setPila] = useState<string | null>();
  const cerradas = new Set((evoluciones.data ?? []).map((e) => e.citaId).filter(Boolean));
  const ahora = Date.now();
  const sesiones = (citas.data ?? [])
    .filter((c) => c.estado === 'CONFIRMADA' && new Date(c.fin).getTime() <= ahora && c.profesionalId === cuenta.data?.id && !cerradas.has(c.id))
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  const ultimoRiesgo = [...(evoluciones.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((e) => e.nivelRiesgo)?.nivelRiesgo;
  // `?borrador=` (desde la lista de pendientes): se abre una vez, cuando llegan los borradores.
  const abiertoDesdeUrl = useRef(false);
  useEffect(() => {
    if (abiertoDesdeUrl.current || !borradorInicial || !borradores.data) return;
    abiertoDesdeUrl.current = true;
    const b = borradores.data.find((x) => x.id === borradorInicial);
    if (b) setEditor({ borrador: b });
  }, [borradorInicial, borradores.data]);
  const cerrar = () => {
    setEditor(null);
    if (citaInicial || borradorInicial || nueva) router.replace(`/admin/fichas/${paciente.id}?vista=evoluciones`, { scroll: false });
  };

  return (
    // xl+: columna angosta a la derecha con el contexto del editor (si esta abierto), contacto y conversaciones; bajo eso, al final.
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        {ultimoRiesgo && (ultimoRiesgo === 'MEDIO' || ultimoRiesgo === 'ALTO') && (
          <Aviso tono="advertencia" icono="priority_high" titulo={`Último registro: ${NIVEL_RIESGO[ultimoRiesgo].texto.toLowerCase()}`}>
            Revisa el plan de seguimiento y los contactos de emergencia.
          </Aviso>
        )}
        {editor ? (
          <EditorEvolucion
            key={editor.borrador?.id ?? editor.corrige?.id ?? 'nueva'}
            fichaId={fichaId}
            pacienteId={paciente.id}
            sesiones={sesiones}
            borrador={editor.borrador}
            corrige={editor.corrige}
            citaInicial={editor.cita}
            onListo={cerrar}
            onBorradorGuardado={() => setPila('borradores')}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
              {sesiones.length === 0
                ? 'Todas tus sesiones realizadas tienen evolución.'
                : sesiones.length === 1
                  ? '1 sesión realizada sin evolución.'
                  : `${sesiones.length} sesiones realizadas sin evolución.`}
            </p>
            <Button variant="team" icon="edit_note" onClick={() => setEditor({ cita: sesiones[0]?.id })}>
              Nueva evolución
            </Button>
          </div>
        )}

        <EstadoConsulta consulta={evoluciones}>
          {(lista) => (
            <FichaClinicaTimeline
              evoluciones={lista}
              borradores={borradores.data ?? []}
              citas={citas.data ?? []}
              miId={cuenta.data?.id}
              conSupervision={rol === 'PRACTICANTE'}
              pila={pila}
              onPila={setPila}
              editorAbierto={!!editor}
              onContinuar={(b) => {
                setEditor({ borrador: b });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onCorregir={(e) => {
                setEditor({ corrige: e });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
        </EstadoConsulta>
      </div>
      {/* Sticky solo sin editor: con el contexto la columna puede ser mas alta que la ventana. */}
      <div className={`flex min-w-0 flex-col gap-4 ${editor ? '' : 'xl:sticky xl:top-6'}`}>
        {editor && <ContextoEscritura pacienteId={paciente.id} fichaId={fichaId} evoluciones={evoluciones.data ?? []} />}
        <ContactoEmergencia paciente={paciente} />
        <ConversacionesCaso pacienteId={paciente.id} />
      </div>
    </div>
  );
}

/** Valor de animo de una evolucion: escala insertada o campo numerico de la plantilla. */
function animoDe(e: EvolucionVista): number | undefined {
  const escala = separarNotas(e.notas ?? '').escalas.find((x) => /[aá]nimo/i.test(x.nombre));
  const campo = Object.entries(e.valores ?? {}).find(([k, v]) => /animo/i.test(k) && typeof v === 'number')?.[1];
  return escala?.valor ?? (campo as number | undefined);
}

/** "Para escribir esta sesion": lo que el profesional necesita a la vista. Cada tarjeta se oculta sin datos. */
function ContextoEscritura({ pacienteId, fichaId, evoluciones }: { pacienteId: string; fichaId: string; evoluciones: readonly EvolucionVista[] }) {
  const motivo = useMotivoConsulta(pacienteId, fichaId);
  const recientes = [...evoluciones].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ultima = recientes[0];
  const tareas = ultima ? separarNotas(ultima.notas ?? '').tareas : [];
  const tareaPlantilla = Object.entries(ultima?.valores ?? {}).find(([k, v]) => /tarea/i.test(k) && typeof v === 'string' && v.trim())?.[1];
  const acordado = [...tareas, ...(typeof tareaPlantilla === 'string' ? [tareaPlantilla] : [])];
  const animos = recientes
    .map((e) => ({ id: e.id, fecha: e.createdAt, valor: animoDe(e) }))
    .filter((a): a is { id: string; fecha: string; valor: number } => a.valor !== undefined)
    .slice(0, 5)
    .reverse();
  const tarjeta = 'flex flex-col gap-1.5 rounded-[14px] border border-divider bg-bg p-4';
  return (
    <aside aria-labelledby="titulo-contexto" className="flex min-w-0 flex-col gap-3.5">
      <h2 id="titulo-contexto" className="m-0 text-[17px] font-black">
        Para escribir esta sesión
      </h2>
      <div className={tarjeta}>
        <span className="text-[12px] font-bold text-neutral-700">Motivo de consulta</span>
        <span className="text-[14.5px] font-semibold whitespace-pre-line">{motivo}</span>
      </div>
      {acordado.length > 0 && (
        <div className={tarjeta}>
          <span className="text-[12px] font-bold text-neutral-700">Acordado en la última evolución</span>
          <ul className="m-0 list-disc pl-5 text-[14.5px] font-semibold">
            {acordado.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {animos.length > 0 && (
        <div className={tarjeta}>
          <span className="text-[12px] font-bold text-neutral-700">Evolución del ánimo reportado</span>
          <div
            role="img"
            aria-label={`Ánimo en las últimas evoluciones: ${animos.map((a) => a.valor).join(', ')} de 10`}
            className="flex h-14 items-end gap-1.5"
          >
            {animos.map((a, i) => (
              <span
                key={a.id}
                title={`${formatoFecha(a.fecha)}: ${a.valor}/10`}
                className={`flex-1 rounded-t-[4px] ${i === animos.length - 1 ? 'bg-accent-700' : 'bg-neutral-400'}`}
                style={{ height: `${a.valor * 10}%` }}
              />
            ))}
          </div>
          <span className="text-[12px] font-semibold text-neutral-700">
            Últimas {animos.length} · va de {animos[0]!.valor} a {animos[animos.length - 1]!.valor}
          </span>
        </div>
      )}
    </aside>
  );
}

/** Conversaciones internas del caso (las ve quien tiene acceso clinico vigente). */
export function ConversacionesCaso({ pacienteId }: { pacienteId: string }) {
  const hilos = useHilos(pacienteId);
  const lista = hilos.data ?? [];
  return (
    <Panel titulo="Conversaciones del caso" nivel={2}>
      <div className="flex flex-col gap-2.5">
        {lista.length === 0 ? (
          <p className="m-0 text-[13.5px] font-semibold text-neutral-700">Sin conversaciones con el equipo sobre este paciente.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {lista.map((h) => (
              <li key={h.id} className="border-b border-divider py-2 last:border-b-0">
                <Link
                  href={`/admin/mensajes?hilo=${h.id}`}
                  className="flex min-h-10 items-center justify-between gap-2 text-[13.5px] font-extrabold hover:text-accent-700"
                >
                  <span className="truncate">{h.asunto ?? 'Conversación'}</span>
                  {h.noLeidos > 0 && <Badge tono="atencion">{h.noLeidos}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <ButtonLink href={`/admin/mensajes?caso=${pacienteId}`} variant="secondary" icon="chat" className="self-start !py-2.5">
          Nueva conversación
        </ButtonLink>
      </div>
    </Panel>
  );
}

/** Punto 38: contactos que agrego el paciente (existencia y parentesco; la RLS limita al tratante). */
export function useContactosTratante(pacienteId: string) {
  return useQuery({
    queryKey: ['panel', 'contactos-emergencia', pacienteId],
    queryFn: () => datos(api.GET('/api/pacientes/{id}/contactos-emergencia', { params: { path: { id: pacienteId } } })),
  });
}

/** Linea corta para el resumen de la ficha: "Madre, Hermano" o "sin registrar". */
export function ResumenContactoTratante({ pacienteId }: { pacienteId: string }) {
  const contactos = useContactosTratante(pacienteId);
  if (!contactos.data) return null;
  return contactos.data.length ? (
    <strong>{contactos.data.map((c) => c.parentesco).join(', ')}</strong>
  ) : (
    <strong className="text-pendiente-900">sin registrar</strong>
  );
}

/**
 * Contacto de emergencia (punto 38): el tratante ve que existe y el
 * parentesco. Nombre y telefono, solo en una emergencia: pide el motivo y la
 * BD lo registra en accesos_ficha. Sin contactos, puede pedirle al paciente que
 * agregue uno (una vez por semana). Adultos responsables y telefono del
 * paciente siguen visibles (son de la atencion).
 */
export function ContactoEmergencia({ paciente }: { paciente: PacienteVista }) {
  const adultos = useAdultosResponsables(paciente.id);
  const contactos = useContactosTratante(paciente.id);
  const [emergencia, setEmergencia] = useState(false);
  const pedir = useMutation({
    mutationFn: () => datos(api.POST('/api/pacientes/{id}/contactos-emergencia/aviso', { params: { path: { id: paciente.id } } })),
  });
  const lista = contactos.data ?? [];
  return (
    <Panel titulo="Contacto de emergencia" nivel={2}>
      <div className="flex flex-col gap-3">
        {contactos.isPending ? (
          <span aria-hidden="true" className="esqueleto block h-6 w-40 rounded" />
        ) : lista.length ? (
          <>
            <p className="m-0 text-[14.5px] font-semibold">
              {lista.length === 1 ? 'Tiene uno: ' : `Tiene ${lista.length}: `}
              <strong>{lista.map((c) => c.parentesco).join(', ')}</strong>
            </p>
            <Button variant="secondary" icon="call" onClick={() => setEmergencia(true)} className="self-start !py-2 !text-[13px]">
              Ver datos (emergencia)
            </Button>
          </>
        ) : (
          <>
            <p className="m-0 text-[14.5px] font-semibold text-pendiente-900">El paciente no ha agregado un contacto de emergencia.</p>
            {pedir.isSuccess ? (
              <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
                Le enviamos el aviso a su bandeja y su correo.
              </p>
            ) : (
              <Button variant="secondary" icon="send" loading={pedir.isPending} onClick={() => pedir.mutate()} className="self-start !py-2 !text-[13px]">
                Pedirle que agregue uno
              </Button>
            )}
            {pedir.error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {pedir.error instanceof ApiError ? pedir.error.message : 'No pudimos enviar el aviso.'}
              </p>
            )}
          </>
        )}
        {(adultos.data ?? []).length > 0 && (
          <div className="border-t border-divider pt-3">
            <p className="m-0 mb-1.5 text-xs font-extrabold text-neutral-700">Adulto responsable</p>
            {adultos.data!.map((a) => (
              <p key={a.id} className="m-0 text-[14px] font-semibold">
                {a.nombre}
                {a.parentesco ? ` (${a.parentesco})` : ''}
                {a.telefono ? ` · ${formatoTelefono(a.telefono)}` : ''}
              </p>
            ))}
          </div>
        )}
        {paciente.telefono && (
          <p className="m-0 border-t border-divider pt-3 text-[13px] font-semibold text-neutral-700">
            Teléfono del paciente: <span className="font-extrabold text-text">{formatoTelefono(paciente.telefono)}</span>
          </p>
        )}
      </div>
      <Modal abierto={emergencia} onCerrar={() => setEmergencia(false)} titulo="Datos de contacto de emergencia">
        {emergencia && <DatosEmergencia paciente={paciente} />}
      </Modal>
    </Panel>
  );
}

function DatosEmergencia({ paciente }: { paciente: PacienteVista }) {
  const [motivo, setMotivo] = useState('');
  const abrir = useMutation({
    mutationFn: () =>
      datos(api.POST('/api/pacientes/{id}/contactos-emergencia/emergencia', { params: { path: { id: paciente.id } }, body: { motivo: motivo.trim() } })),
  });
  if (abrir.data)
    return (
      <div className="flex flex-col gap-2.5">
        {abrir.data.map((c) => (
          <p key={c.id} className="m-0 rounded-lg border border-divider bg-bg px-4 py-3 text-[14.5px] font-semibold">
            <strong>{c.nombre}</strong> ({c.parentesco}) ·{' '}
            <a href={`tel:${c.telefono}`} className="font-extrabold text-accent-2-800">
              {formatoTelefono(c.telefono)}
            </a>
          </p>
        ))}
        {paciente.contactoEmergencia && (
          <p className="m-0 text-[13px] font-semibold text-neutral-800">Registrado antes por el centro: {paciente.contactoEmergencia}</p>
        )}
        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Quedó registrado que abriste estos datos y por qué.</p>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (motivo.trim().length >= 5) abrir.mutate();
      }}
      className="flex flex-col gap-3"
    >
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Solo en una emergencia. Escribe el motivo: queda registrado en los accesos a la ficha.</p>
      <Field label="Motivo de la emergencia" required hint="Entre 5 y 200 caracteres.">
        {(p) => <Input {...p} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Field>
      {abrir.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {abrir.error instanceof ApiError ? abrir.error.message : 'No pudimos abrir los datos.'}
        </p>
      )}
      <Button type="submit" variant="team" icon="call" disabled={motivo.trim().length < 5} loading={abrir.isPending} className="self-end">
        Ver datos
      </Button>
    </form>
  );
}
