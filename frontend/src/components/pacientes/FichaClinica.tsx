'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EnlaceVolver } from '@/components/ui/EnlaceVolver';
import { Panel } from '@/components/ui/Panel';
import { Pestanas } from '@/components/ui/Pestanas';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useMiCuenta } from '@/lib/consultas';
import { NIVEL_RIESGO, useBorradores, type BorradorVista, type EvolucionVista } from '@/lib/fichas';
import { formatoFecha, formatoFechaHora, formatoTelefono } from '@/lib/formato';
import { useHilos } from '@/lib/mensajes';
import { useAdultosResponsables, useCitas, useEvoluciones, useFicha, usePaciente, type PacienteVista } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { AccesosPaciente } from './AccesosTemporales';
import { AdjuntosFicha } from './AdjuntosFicha';
import { AltaPaciente } from './AltaPaciente';
import { DocumentosFicha } from './DocumentosFicha';
import { EditorEvolucion } from './EditorEvolucion';
import { FichaClinicaTimeline } from './FichaClinicaTimeline';
import { IngresoFicha } from './IngresoFicha';
import { SolicitudesEpicrisis } from './SolicitudesEpicrisis';

type Vista = 'evoluciones' | 'ingreso' | 'documentos' | 'adjuntos' | 'accesos' | 'alta';

const PESTANAS: readonly { valor: Vista; etiqueta: string }[] = [
  { valor: 'evoluciones', etiqueta: 'Evoluciones' },
  { valor: 'ingreso', etiqueta: 'Ficha de ingreso' },
  { valor: 'documentos', etiqueta: 'Documentos' },
  { valor: 'adjuntos', etiqueta: 'Adjuntos' },
  { valor: 'accesos', etiqueta: 'Accesos' },
  { valor: 'alta', etiqueta: 'Alta' },
];

/**
 * Ficha clinica (03b-5): solo el equipo tratante (PROFESIONAL o PRACTICANTE
 * con acceso; tambien quien tiene un acceso clinico temporal vigente). La RLS
 * decide; ADMIN y GESTION nunca ven el contenido. Secciones en la URL
 * (`?vista=`); `?cita=` abre una evolucion nueva para esa sesion.
 */
export function FichaClinica({ pacienteId, rol }: { pacienteId: string; rol: Rol }) {
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const paciente = usePaciente(pacienteId);
  const ficha = useFicha(pacienteId, clinico);
  const cuenta = useMiCuenta();
  const parametros = useSearchParams();
  const router = useRouter();
  // Accesos temporales: los otorga y los ve el tratante PROFESIONAL (la API no los entrega al practicante).
  const pestanas = PESTANAS.filter((p) => p.valor !== 'accesos' || rol === 'PROFESIONAL');
  const vista = (pestanas.find((p) => p.valor === parametros.get('vista'))?.valor ?? 'evoluciones') as Vista;
  const ir = (v: Vista) =>
    router.replace(v === 'evoluciones' ? `/admin/fichas/${pacienteId}/ficha` : `/admin/fichas/${pacienteId}/ficha?vista=${v}`, { scroll: false });

  if (!clinico) {
    return (
      <>
        <EnlaceVolver href={`/admin/fichas/${pacienteId}`}>Volver al paciente</EnlaceVolver>
        <EstadoVista
          estado="sin-permiso"
          titulo="La ficha clínica es del equipo tratante"
          mensaje="Administración ve que la ficha existe, nunca su contenido (secreto profesional). Cambia al rol profesional si también atiendes."
        />
      </>
    );
  }
  return (
    <EstadoConsulta consulta={paciente}>
      {(p) => (
        <>
          <EnlaceVolver href={`/admin/fichas/${p.id}`}>Volver al paciente</EnlaceVolver>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="m-0 mb-1 text-[11px] font-extrabold tracking-[0.1em] text-accent-800 uppercase">Ficha clínica</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-[clamp(28px,3.4vw,36px)] leading-[1.05] font-black tracking-[-0.03em]">
                  {p.nombre} {p.apellido}
                </h1>
                {edadEn(p.fechaNacimiento) < 18 && <Badge tono="atencion">Menor de edad</Badge>}
              </div>
              <p className="m-0 mt-1.5 text-[14px] font-semibold text-neutral-800">
                {edadEn(p.fechaNacimiento)} años{ficha.data ? ` · ficha abierta el ${formatoFecha(ficha.data.fechaApertura)}` : ''}
              </p>
            </div>
          </div>
          {ficha.isPending ? (
            <EstadoVista estado="carga" />
          ) : ficha.error || !ficha.data ? (
            <EstadoVista
              estado={ficha.error instanceof ApiError && ficha.error.status === 403 ? 'sin-permiso' : 'vacio'}
              titulo="No tienes acceso a esta ficha"
              mensaje="La ven su profesional tratante y quien tenga un acceso clínico temporal vigente. Si todavía no está abierta, se abre desde el detalle del paciente."
            />
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-w-0 flex-col gap-4">
                <Pestanas etiqueta="Secciones de la ficha" tono="team" valor={vista} onChange={ir} pestanas={pestanas} panelId="seccion-ficha" />
                <div id="seccion-ficha" role="tabpanel" className="entrada" key={vista}>
                  {vista === 'evoluciones' && (
                    <EvolucionesFicha
                      fichaId={ficha.data.id}
                      paciente={p}
                      citaInicial={parametros.get('cita') ?? undefined}
                      borradorInicial={parametros.get('borrador') ?? undefined}
                      rol={rol}
                    />
                  )}
                  {vista === 'ingreso' && <IngresoFicha fichaId={ficha.data.id} miId={cuenta.data?.id} />}
                  {vista === 'documentos' && (
                    <div className="flex flex-col gap-4">
                      <SolicitudesEpicrisis pacienteId={p.id} puedeResolver />
                      <DocumentosFicha pacienteId={p.id} />
                    </div>
                  )}
                  {vista === 'adjuntos' && <AdjuntosFicha pacienteId={p.id} />}
                  {vista === 'accesos' && <AccesosPaciente pacienteId={p.id} tratanteId={p.profesionalId} puedeOtorgar={p.profesionalId === cuenta.data?.id} />}
                  {vista === 'alta' && <AltaPaciente pacienteId={p.id} />}
                </div>
              </div>
              {/* En pantallas angostas el contacto de emergencia va antes que las secciones (dato de seguridad). */}
              <aside className="order-first flex min-w-0 flex-col gap-4 xl:order-none" aria-label="Datos de contacto">
                <ContactoEmergencia paciente={p} />
                <ConversacionesCaso pacienteId={p.id} />
              </aside>
            </div>
          )}
        </>
      )}
    </EstadoConsulta>
  );
}

/** Evoluciones: borradores propios de esta ficha, editor y linea de tiempo. */
function EvolucionesFicha({
  fichaId,
  paciente,
  citaInicial,
  borradorInicial,
  rol,
}: {
  fichaId: string;
  paciente: PacienteVista;
  citaInicial?: string;
  borradorInicial?: string;
  rol: Rol;
}) {
  const cuenta = useMiCuenta();
  const evoluciones = useEvoluciones(fichaId, true);
  const borradores = useBorradores(fichaId);
  const citas = useCitas({ pacienteId: paciente.id });
  const router = useRouter();
  const [editor, setEditor] = useState<{ borrador?: BorradorVista; corrige?: EvolucionVista; cita?: string } | null>(
    citaInicial ? { cita: citaInicial } : null,
  );
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
    if (citaInicial || borradorInicial) router.replace(`/admin/fichas/${paciente.id}/ficha`, { scroll: false });
  };
  const pendientes = (borradores.data ?? []).filter((b) => b.id !== editor?.borrador?.id);

  return (
    <div className="flex flex-col gap-4">
      {ultimoRiesgo && (ultimoRiesgo === 'MEDIO' || ultimoRiesgo === 'ALTO') && (
        <Aviso tono="advertencia" icono="priority_high" titulo={`Último registro: ${NIVEL_RIESGO[ultimoRiesgo].texto.toLowerCase()}`}>
          Revisa el plan de seguimiento y los contactos de emergencia.
        </Aviso>
      )}
      {editor ? (
        <EditorEvolucion
          key={editor.borrador?.id ?? editor.corrige?.id ?? 'nueva'}
          fichaId={fichaId}
          sesiones={sesiones}
          borrador={editor.borrador}
          corrige={editor.corrige}
          citaInicial={editor.cita}
          onListo={cerrar}
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

      {pendientes.length > 0 && (
        <Panel titulo="Borradores sin confirmar" bajada="Solo los ves tú. No forman parte del expediente hasta que los confirmes." nivel={2}>
          <ul className="m-0 flex list-none flex-col p-0">
            {pendientes.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="m-0 line-clamp-1 text-[14px] font-extrabold">{b.contenido}</p>
                  <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Guardado el {formatoFechaHora(b.actualizadoEn)}</p>
                </div>
                <Button variant="secondary" icon="draft" disabled={!!editor} onClick={() => setEditor({ borrador: b })} className="!px-4 !py-2 !text-[13px]">
                  Continuar
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <EstadoConsulta consulta={evoluciones} vacio={(l) => l.length === 0} textoVacio="Todavía no hay evoluciones registradas">
        {(lista) => (
          <FichaClinicaTimeline
            evoluciones={lista}
            miId={cuenta.data?.id}
            conSupervision={rol === 'PRACTICANTE'}
            onCorregir={(e) => {
              setEditor({ corrige: e });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </EstadoConsulta>
    </div>
  );
}

/** Conversaciones internas del caso (las ve quien tiene acceso clinico vigente). */
function ConversacionesCaso({ pacienteId }: { pacienteId: string }) {
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

/** Contacto de emergencia y adultos responsables: visibles para el tratante dentro de la ficha. */
function ContactoEmergencia({ paciente }: { paciente: PacienteVista }) {
  const adultos = useAdultosResponsables(paciente.id);
  return (
    <Panel titulo="Contacto de emergencia" nivel={2}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[14.5px] font-semibold whitespace-pre-line">{paciente.contactoEmergencia ?? 'Sin registrar. Pídelo en recepción.'}</p>
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
    </Panel>
  );
}
