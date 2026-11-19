'use client';

import { DialogoDescartar, useGuardaCambios } from '@/components/shared/EdicionSegura';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Paginador, usePaginacion } from '@/components/ui/Paginador';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { useMiCuenta } from '@/lib/consultas';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';
import { nombresDe, useEquipoPortal, useMensajesPortal, type MensajePortal } from '@/lib/portal';

const MAXIMO = 5000;

/**
 * "Escribirle a X" del diseño. Puntos 40/44: conversacion en la plataforma;
 * el profesional responde aqui (al correo solo llega el aviso, nunca el
 * texto). El adulto responsable escribe por el menor y ve lo que el escribio
 * y lo que le respondieron. Las respuestas se marcan leidas al verlas.
 */
export function MensajeProfesional({ vista = 'inicio' }: { vista?: 'inicio' | 'mensajes' }) {
  const portal = usePortal();
  const equipo = useEquipoPortal();
  const mensajes = useMensajesPortal();
  const cliente = useQueryClient();
  const nombres = nombresDe(equipo.data);
  const tratante = portal.paciente?.profesionalId ?? equipo.data?.[0]?.id;
  const [destino, setDestino] = useState<string>();
  const [texto, setTexto] = useState('');
  const [enviado, setEnviado] = useState<string>();
  const guarda = useGuardaCambios(texto.trim() !== '');
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
  // Si su tratante no esta disponible (desactivado, de baja o con bloqueo) no se le escribe: "Mi profesional" ofrece las opciones.
  const estado = useQuery({
    queryKey: ['portal', 'estado-tratante', portal.pacienteParam ?? 'propio'],
    queryFn: () => datos(api.GET('/api/portal/estado-tratante', { params: { query: { pacienteId: portal.pacienteParam } } })),
    enabled: !portal.cargando && !!portal.paciente?.profesionalId,
  });
  const ausente = estado.data?.disponible === false && profesionalId === estado.data.tratanteId;
  // Inicio: los ultimos 3 de la conversacion. Mensajes: lo enviado, en paginas (las respuestas van en su propio panel).
  const lista = vista === 'mensajes' ? delPaciente.filter((m) => !m.deProfesional) : delPaciente;
  const paginas = usePaginacion(lista, 'portal-mensajes-enviados');
  const visibles = vista === 'mensajes' ? paginas.visibles : lista.slice(0, 3);
  const cuenta = useMiCuenta();
  // Respuestas sin leer dirigidas a esta cuenta: se marcan al mostrarse.
  const sinLeer = delPaciente.filter((m) => m.deProfesional && !m.leidoEn && m.destinatarioId === cuenta.data?.id).map((m) => m.id);
  const claveSinLeer = sinLeer.join(',');
  useEffect(() => {
    if (!claveSinLeer) return;
    void Promise.all(claveSinLeer.split(',').map((id) => api.POST('/api/mensajes/{id}/leido', { params: { path: { id } } }))).then(() =>
      cliente.invalidateQueries({ queryKey: ['portal', 'mensajes'] }),
    );
  }, [claveSinLeer, cliente]);

  return (
    <Panel id="mensajes" titulo={`Escribirle a ${primerNombre}`} bajada={`${primerNombre} lo recibe en su bandeja y te responde aquí mismo.`}>
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
      ) : ausente ? (
        <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
          Tu profesional no está disponible por unos días. En «Mi profesional» puedes pedir otro profesional del equipo; cuando te lo asignen podrás escribirle
          aquí.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
          <DialogoDescartar seccion="tu mensaje" {...guarda.dialogo} />
          {(equipo.data?.length ?? 0) > 1 && (
            <Field label="Para">
              {(p) => (
                <Select buscable {...p} value={profesionalId} onChange={(e) => setDestino(e.target.value)}>
                  {equipo.data!.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre ?? 'Profesional del centro'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Mensaje" hint={texto.length ? `${texto.length} de ${MAXIMO} caracteres` : 'Enter envía; Shift+Enter hace un salto de línea.'}>
            {(p) => (
              <Textarea
                {...p}
                enterEnvia
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
        <h3 className="m-0 mb-3.5 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">
          {vista === 'mensajes' ? 'Lo que has enviado' : 'Conversación'}
        </h3>
        <EstadoConsulta consulta={mensajes} vacio={() => lista.length === 0} textoVacio="Todavía no hay mensajes">
          {() => (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {visibles.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-[18px] border px-[18px] py-4 ${m.deProfesional ? 'border-accent-2-500 bg-accent-2-100' : 'border-divider bg-bg'}`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <Icon name={m.deProfesional ? 'chat' : 'north_east'} size={17} className="text-accent-2-700" />
                    <span className="text-[12.5px] font-extrabold">
                      {m.deProfesional
                        ? `Respuesta de ${nombres.get(m.profesionalId) ?? 'tu profesional'}`
                        : `Enviado a ${nombres.get(m.profesionalId) ?? 'tu profesional'}`}
                    </span>
                    <span className="ml-auto text-xs font-bold text-neutral-700 first-letter:uppercase">{formatoFechaLarga(m.creadoEn)}</span>
                  </div>
                  <p className="m-0 text-[14px] leading-relaxed font-medium whitespace-pre-line text-pretty text-neutral-800">{m.contenido}</p>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
        {vista === 'mensajes' && <Paginador {...paginas} etiqueta="mensajes" />}
        <p className="m-0 mt-4 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
          <Icon name="info" size={16} />
          Tu profesional te responde aquí; te avisamos por correo cuando lo haga.
        </p>
      </div>
    </Panel>
  );
}

/**
 * Pagina Mensajes (puntos 40/44): la ultima respuesta del profesional en
 * grande y, debajo, las anteriores compactas y en paginas (no listas largas).
 */
export function RespuestasProfesional() {
  const portal = usePortal();
  const equipo = useEquipoPortal();
  const mensajes = useMensajesPortal();
  const nombres = nombresDe(equipo.data);
  const respuestas: MensajePortal[] = (mensajes.data ?? []).filter(
    (m) => m.deProfesional && (!portal.pacienteId || !m.pacienteId || m.pacienteId === portal.pacienteId),
  );
  const [ultima, ...anteriores] = respuestas;
  const paginas = usePaginacion(anteriores, 'portal-respuestas');
  return (
    <Panel titulo="Respuestas de tu profesional" bajada="La más reciente arriba; las anteriores, más abajo.">
      <EstadoConsulta consulta={mensajes} vacio={() => respuestas.length === 0} textoVacio="Tu profesional todavía no te ha respondido">
        {() => (
          <div className="flex flex-col gap-4">
            {ultima && (
              <article className="rounded-lg border border-accent-2-500 bg-accent-2-100 px-[clamp(18px,3vw,26px)] py-5">
                <p className="m-0 mb-2 text-[12.5px] font-extrabold text-accent-2-900">
                  {nombres.get(ultima.profesionalId) ?? 'Tu profesional'} · <span className="first-letter:uppercase">{formatoFechaLarga(ultima.creadoEn)}</span>
                </p>
                <p className="m-0 text-[17px] leading-relaxed font-semibold whitespace-pre-line text-pretty">{ultima.contenido}</p>
              </article>
            )}
            {anteriores.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Respuestas anteriores</h3>
                <ul className="m-0 flex list-none flex-col divide-y divide-divider rounded-lg border border-divider bg-bg p-0">
                  {paginas.visibles.map((m) => (
                    <li key={m.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                      <span className="text-[12px] font-bold text-neutral-700 first-letter:uppercase">{formatoFechaLarga(m.creadoEn)}</span>
                      <span className="line-clamp-2 text-[13.5px] font-semibold text-pretty" title={m.contenido}>
                        {m.contenido}
                      </span>
                    </li>
                  ))}
                </ul>
                <Paginador {...paginas} etiqueta="respuestas" />
              </div>
            )}
          </div>
        )}
      </EstadoConsulta>
    </Panel>
  );
}
