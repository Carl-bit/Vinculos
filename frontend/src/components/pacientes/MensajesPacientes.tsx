'use client';

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Textarea } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora } from '@/lib/formato';
import { useMensajesPacientes, type MensajePaciente } from '@/lib/mensajes';
import { consultaPaciente } from '@/lib/panel';

const MAX = 5000;

/**
 * Puntos 40/44: bandeja del profesional con sus pacientes, agrupada por
 * paciente. Lo que escribe el paciente (o su adulto responsable) y las
 * respuestas del profesional quedan en la misma conversacion (dato clinico,
 * cifrado; la cuenta madre no lo lee). Abrir una conversacion marca leido lo
 * recibido; la respuesta va a quien escribio el ultimo mensaje.
 */
export function MensajesPacientes() {
  const mensajes = useMensajesPacientes(true);
  const ids = [...new Set((mensajes.data ?? []).flatMap((m) => (m.pacienteId ? [m.pacienteId] : [])))];
  const pacientes = useQueries({ queries: ids.map(consultaPaciente) });
  const paciente = new Map(pacientes.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <EstadoConsulta consulta={mensajes} vacio={(l) => l.length === 0} textoVacio="No tienes mensajes de pacientes">
      {(lista) => {
        // Conversaciones: por paciente, la mas reciente primero.
        const grupos = new Map<string, MensajePaciente[]>();
        for (const m of lista) {
          if (!m.pacienteId) continue;
          grupos.set(m.pacienteId, [...(grupos.get(m.pacienteId) ?? []), m]);
        }
        const orden = [...grupos.entries()].sort((a, b) => b[1][0]!.creadoEn.localeCompare(a[1][0]!.creadoEn));
        const actual = abierto ? grupos.get(abierto) : undefined;
        return (
          <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <section aria-label="Conversaciones con pacientes" className="flex flex-col gap-1 rounded-lg border border-divider bg-bg p-3">
              {orden.map(([id, ms]) => {
                const p = paciente.get(id);
                const sinLeer = ms.filter((m) => !m.deProfesional && !m.leidoEn).length;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={abierto === id}
                    onClick={() => setAbierto((a) => (a === id ? null : id))}
                    className={`flex min-h-14 w-full cursor-pointer items-start justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left transition-colors duration-200 ${abierto === id ? 'bg-accent-200' : 'hover:bg-accent-100'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-extrabold">{p ? `${p.nombre} ${p.apellido}` : 'Paciente'}</span>
                      <span className="block text-[12px] font-semibold text-neutral-800">{formatoFechaHora(ms[0]!.creadoEn)}</span>
                    </span>
                    {sinLeer > 0 && <Badge tono="atencion">{sinLeer} sin leer</Badge>}
                  </button>
                );
              })}
            </section>
            {actual && abierto ? (
              <Conversacion
                key={abierto}
                pacienteId={abierto}
                nombre={paciente.get(abierto) ? `${paciente.get(abierto)!.nombre} ${paciente.get(abierto)!.apellido}` : 'Paciente'}
                mensajes={actual}
                onCerrar={() => setAbierto(null)}
              />
            ) : (
              <EstadoVista
                estado="vacio"
                titulo="Elige una conversación"
                mensaje="Las respuestas le llegan al paciente en su cuenta; al correo solo le avisamos."
              />
            )}
          </div>
        );
      }}
    </EstadoConsulta>
  );
}

function Conversacion({ pacienteId, nombre, mensajes, onCerrar }: { pacienteId: string; nombre: string; mensajes: MensajePaciente[]; onCerrar: () => void }) {
  const cliente = useQueryClient();
  const [texto, setTexto] = useState('');
  const cronologico = [...mensajes].sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
  // Se responde a quien escribio por ultimo (el paciente o su adulto responsable).
  const ultimoRecibido = [...cronologico].reverse().find((m) => !m.deProfesional);
  const sinLeer = mensajes.filter((m) => !m.deProfesional && !m.leidoEn).map((m) => m.id);
  const claveSinLeer = sinLeer.join(',');
  useEffect(() => {
    if (!claveSinLeer) return;
    void Promise.all(claveSinLeer.split(',').map((id) => api.POST('/api/mensajes/{id}/leido', { params: { path: { id } } }))).then(() => {
      void cliente.invalidateQueries({ queryKey: ['mensajes-pacientes'] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
    });
  }, [claveSinLeer, cliente]);
  const responder = useMutation({
    mutationFn: () => datos(api.POST('/api/mensajes/respuesta', { body: { mensajeId: ultimoRecibido!.id, contenido: texto.trim() } })),
    onSuccess: () => {
      setTexto('');
      void cliente.invalidateQueries({ queryKey: ['mensajes-pacientes'] });
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim() && ultimoRecibido) responder.mutate();
  };
  return (
    <section
      aria-label={`Conversación con ${nombre}`}
      className="flex flex-col gap-3.5 rounded-lg border border-divider bg-bg px-[clamp(16px,2.6vw,22px)] py-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-3">
        <h2 className="m-0 text-[18px] font-black">{nombre}</h2>
        <div className="flex gap-2">
          <ButtonLink href={`/admin/fichas/${pacienteId}`} variant="ghost" className="!px-3.5 !py-2 !text-[13px]">
            Ver ficha
          </ButtonLink>
          <Button variant="secondary" icon="close" onClick={onCerrar} className="!px-3.5 !py-2 !text-[13px]">
            Cerrar
          </Button>
        </div>
      </header>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {cronologico.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-lg border px-3.5 py-2.5 ${m.deProfesional ? 'self-end border-accent-300 bg-accent-200' : 'self-start border-divider bg-surface'}`}
          >
            <p className="m-0 text-[12px] font-extrabold text-neutral-800">
              {m.deProfesional ? 'Tú' : nombre} · {formatoFechaHora(m.creadoEn)}
              {m.deProfesional && (m.leidoEn ? ' · leído' : ' · sin leer')}
            </p>
            <p className="m-0 text-[14.5px] font-semibold whitespace-pre-line text-pretty">{m.contenido}</p>
          </li>
        ))}
      </ol>
      {responder.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {responder.error instanceof ApiError ? responder.error.message : 'No pudimos enviar la respuesta.'}
        </p>
      )}
      {ultimoRecibido ? (
        <form onSubmit={enviar} className="flex flex-col gap-2 border-t border-divider pt-3">
          <Field label="Responder" hint="Le llega en su cuenta; al correo solo el aviso. Enter envía; Shift+Enter, salto de línea.">
            {(p) => <Textarea {...p} enterEnvia rows={3} maxLength={MAX} value={texto} onChange={(e) => setTexto(e.target.value)} className="!min-h-20" />}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="team" icon="send" disabled={!texto.trim()} loading={responder.isPending}>
              Responder
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
