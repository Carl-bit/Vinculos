'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';
import { nombresDe, useEquipoPortal, useMensajesPortal } from '@/lib/portal';

const MAXIMO = 5000;

/**
 * "Escribirle a X" del diseño. Comunicacion asimetrica: el mensaje se
 * reenvia al correo del profesional y queda en el historial; la respuesta
 * llega por correo o telefono (no hay respuesta dentro de la plataforma).
 * El adulto responsable escribe por el menor y ve solo lo que el escribio.
 */
export function MensajeProfesional({ historial = 3 }: { historial?: number }) {
  const portal = usePortal();
  const equipo = useEquipoPortal();
  const mensajes = useMensajesPortal();
  const cliente = useQueryClient();
  const nombres = nombresDe(equipo.data);
  const tratante = portal.paciente?.profesionalId ?? equipo.data?.[0]?.id;
  const [destino, setDestino] = useState<string>();
  const [texto, setTexto] = useState('');
  const [enviado, setEnviado] = useState<string>();
  const alerta = useRef<HTMLDivElement>(null);
  const profesionalId = destino ?? tratante;
  const nombre = profesionalId ? (nombres.get(profesionalId) ?? 'tu profesional') : 'tu profesional';
  const primerNombre = nombre.split(' ')[0];

  const enviar = useMutation({
    mutationFn: () =>
      datos(api.POST('/api/portal/mensajes', { body: { profesionalId: profesionalId!, contenido: texto.trim(), pacienteId: portal.pacienteParam } })),
    onSuccess: () => {
      setEnviado(nombre);
      setTexto('');
      void cliente.invalidateQueries({ queryKey: ['portal', 'mensajes'] });
    },
  });
  useEffect(() => {
    if (enviar.error) alerta.current?.focus();
  }, [enviar.error]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim() || !profesionalId) return;
    setEnviado(undefined);
    enviar.mutate();
  };
  const delPaciente = (mensajes.data ?? []).filter((m) => !portal.pacienteId || !m.pacienteId || m.pacienteId === portal.pacienteId);

  return (
    <Panel id="mensajes" titulo={`Escribirle a ${primerNombre}`} bajada={`${primerNombre} responde por correo o teléfono, no dentro de la plataforma.`}>
      <Aviso tono="advertencia" className="mb-4">
        Evita incluir detalles clínicos sensibles: este mensaje se reenvía al correo de tu profesional. Para temas delicados, pide una hora.
      </Aviso>
      {enviado && (
        <Aviso tono="exito" role="status" className="mb-4">
          Tu mensaje fue enviado. {enviado} lo recibirá también por correo.
        </Aviso>
      )}
      {!profesionalId ? (
        <p className="m-0 text-[13.5px] font-semibold text-neutral-700">Podrás escribirle a tu profesional cuando tengas uno asignado.</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
          {(equipo.data?.length ?? 0) > 1 && (
            <Field label="Para">
              {(p) => (
                <Select {...p} value={profesionalId} onChange={(e) => setDestino(e.target.value)}>
                  {equipo.data!.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre ?? 'Profesional del centro'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Mensaje" hint={texto.length ? `${texto.length} de ${MAXIMO} caracteres` : 'Sin respuestas dentro de la plataforma.'}>
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                maxLength={MAXIMO}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setEnviado(undefined);
                }}
                placeholder="Ej. Necesito cambiar mi hora del jueves, ¿tienes disponibilidad en la tarde?"
                className="resize-y !text-[14.5px]"
              />
            )}
          </Field>
          {enviar.error && (
            <div ref={alerta} tabIndex={-1} role="alert" className="text-[13px] font-bold text-accent-700">
              {enviar.error instanceof ApiError ? enviar.error.message : 'No pudimos enviar el mensaje. Intenta de nuevo.'}
            </div>
          )}
          <div>
            <Button type="submit" variant="team" size="lg" icon="send" loading={enviar.isPending} disabled={!texto.trim()} className="!py-3.5 !text-[14.5px]">
              Enviar
            </Button>
          </div>
        </form>
      )}

      <div className="mt-[26px] border-t border-divider pt-[22px]">
        <h3 className="m-0 mb-3.5 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Mensajes que has enviado</h3>
        <EstadoConsulta consulta={mensajes} vacio={() => delPaciente.length === 0} textoVacio="Todavía no has enviado mensajes">
          {() => (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {delPaciente.slice(0, historial).map((m) => (
                <li key={m.id} className="rounded-[18px] border border-divider bg-bg px-[18px] py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <Icon name="north_east" size={17} className="text-accent-2-700" />
                    <span className="text-[12.5px] font-extrabold">Enviado a {nombres.get(m.profesionalId) ?? 'tu profesional'}</span>
                    <span className="ml-auto text-xs font-bold text-neutral-700 first-letter:uppercase">{formatoFechaLarga(m.creadoEn)}</span>
                  </div>
                  <p className="m-0 text-[14px] leading-relaxed font-medium whitespace-pre-line text-pretty text-neutral-800">{m.contenido}</p>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
        <p className="m-0 mt-4 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
          <Icon name="info" size={16} />
          Las respuestas de tu profesional llegan a tu correo o teléfono, no acá.
        </p>
      </div>
    </Panel>
  );
}
