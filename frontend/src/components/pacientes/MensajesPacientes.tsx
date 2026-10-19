'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora, formatoTelefono } from '@/lib/formato';
import { useMensajesPacientes } from '@/lib/mensajes';
import { usePacientes } from '@/lib/panel';

/**
 * Mensajes que escriben los pacientes (o su adulto responsable) desde el
 * portal. Quedan aca y llegan por correo al profesional; la respuesta va por
 * un canal externo (no hay respuesta in-app, CLAUDE.md), por eso se muestran
 * el telefono y el correo registrados.
 */
export function MensajesPacientes() {
  const cliente = useQueryClient();
  const mensajes = useMensajesPacientes(true);
  const pacientes = usePacientes();
  const paciente = new Map((pacientes.data ?? []).map((p) => [p.id, p]));
  const leer = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/mensajes/{id}/leido', { params: { path: { id } } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['mensajes-pacientes'] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <Aviso tono="nota" icono="mail">
        Respóndele al paciente por teléfono o correo: desde el panel no se envían respuestas.
      </Aviso>
      {leer.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {leer.error instanceof ApiError ? leer.error.message : 'No pudimos marcar el mensaje.'}
        </p>
      )}
      <EstadoConsulta consulta={mensajes} vacio={(l) => l.length === 0} textoVacio="No tienes mensajes de pacientes">
        {(lista) => (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {lista.map((m) => {
              const p = m.pacienteId ? paciente.get(m.pacienteId) : undefined;
              const nuevo = !m.leidoEn;
              return (
                <li
                  key={m.id}
                  className={`rounded-lg border bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4 ${nuevo ? 'border-accent-500' : 'border-divider'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-black">
                        {p ? `${p.nombre} ${p.apellido}` : 'Paciente'}
                        {nuevo && <Badge tono="atencion">Sin leer</Badge>}
                      </p>
                      <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                        {formatoFechaHora(m.creadoEn)}
                        {p?.telefono ? ` · ${formatoTelefono(p.telefono)}` : ''}
                        {p?.email ? ` · ${p.email}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p && (
                        <ButtonLink href={`/admin/fichas/${p.id}`} variant="ghost" className="!px-3.5 !py-2 !text-[13px]">
                          Ver paciente
                        </ButtonLink>
                      )}
                      {nuevo && (
                        <Button
                          variant="secondary"
                          icon="mark_email_read"
                          loading={leer.isPending && leer.variables === m.id}
                          onClick={() => leer.mutate(m.id)}
                          className="!px-4 !py-2 !text-[13px]"
                        >
                          Marcar leído
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="m-0 mt-2.5 text-[14.5px] font-semibold whitespace-pre-line text-pretty">{m.contenido}</p>
                </li>
              );
            })}
          </ul>
        )}
      </EstadoConsulta>
    </div>
  );
}
