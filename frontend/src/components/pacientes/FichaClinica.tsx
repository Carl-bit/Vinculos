'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Panel } from '@/components/ui/Panel';
import { useMiCuenta } from '@/lib/consultas';
import { NIVEL_RIESGO, useBorradores, type BorradorVista, type EvolucionVista } from '@/lib/fichas';
import { formatoFechaHora, formatoTelefono } from '@/lib/formato';
import { useHilos } from '@/lib/mensajes';
import { useAdultosResponsables, useCitas, useEvoluciones, type PacienteVista } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { EditorEvolucion } from './EditorEvolucion';
import { FichaClinicaTimeline } from './FichaClinicaTimeline';

/**
 * Piezas clinicas de la vista del paciente (03b-4.2: la ficha ya no es una
 * pagina aparte; vive en las pestañas de DetallePaciente para quien tiene
 * acceso). Solo el equipo tratante o un acceso clinico temporal vigente: la
 * RLS decide y cada lectura queda en accesos_ficha.
 */

/** Evoluciones: borradores propios de esta ficha, editor y linea de tiempo. */
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

/** Contacto de emergencia y adultos responsables: visibles para el tratante dentro de la ficha. */
export function ContactoEmergencia({ paciente }: { paciente: PacienteVista }) {
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
