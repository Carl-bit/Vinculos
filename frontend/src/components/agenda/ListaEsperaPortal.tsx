'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora, formatoFechaLarga } from '@/lib/formato';
import { nombresDe, useEquipoPortal, useListaEsperaPortal } from '@/lib/portal';

/**
 * Lista de espera con cuenta (03a): por profesional. Cuando se libera una
 * hora o el profesional abre horas nuevas, llega un aviso (bandeja y
 * correo) y aqui aparece "Se liberó una hora". La hora no se reserva sola:
 * se pide como siempre.
 */
export function ListaEsperaPortal() {
  const portal = usePortal();
  const cliente = useQueryClient();
  const lista = useListaEsperaPortal(!portal.cargando);
  const equipo = useEquipoPortal();
  const perfiles = useQuery({ queryKey: ['publico', 'profesionales'], queryFn: () => datos(api.GET('/api/publico/profesionales')), staleTime: 10 * 60_000 });
  const nombres = nombresDe(
    equipo.data,
    perfiles.data?.map((p) => ({ id: p.id, nombre: p.nombre_publico })),
  );
  const [profesionalId, setProfesionalId] = useState('');
  const [preferencias, setPreferencias] = useState('');
  const [error, setError] = useState<string>();

  const entradas = (lista.data ?? []).filter((e) => !portal.pacienteId || e.pacienteId === portal.pacienteId);
  const inscritos = new Set(entradas.map((e) => e.profesionalId));
  // Su equipo primero y despues el resto del equipo publico, sin repetir ni los ya inscritos.
  const opciones = [
    ...(equipo.data ?? []).map((p) => ({ id: p.id, nombre: p.nombre ?? 'Profesional del centro' })),
    ...(perfiles.data ?? []).map((p) => ({ id: p.id, nombre: p.nombre_publico ?? 'Profesional del centro' })),
  ].filter((p, i, todos) => todos.findIndex((x) => x.id === p.id) === i && !inscritos.has(p.id));

  const inscribir = useMutation({
    mutationFn: () =>
      datos(api.POST('/api/lista-espera', { body: { pacienteId: portal.pacienteId!, profesionalId, preferencias: preferencias.trim() || undefined } })),
    onSuccess: () => {
      setProfesionalId('');
      setPreferencias('');
      void cliente.invalidateQueries({ queryKey: ['portal', 'lista-espera'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos inscribirte.'),
  });
  const salir = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/lista-espera/{id}/cierre', { params: { path: { id } }, body: { estado: 'CANCELADA' } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['portal', 'lista-espera'] }),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!profesionalId) {
      setError('Elige con quién quieres esperar una hora.');
      return;
    }
    inscribir.mutate();
  };

  return (
    <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
      <Panel titulo="Estás esperando hora con" bajada="Te avisamos por correo y en tu bandeja cuando se libera una hora o hay horas nuevas.">
        <EstadoConsulta consulta={lista} vacio={() => entradas.length === 0} textoVacio="No estás en ninguna lista de espera">
          {() => (
            <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
              {entradas.map((e) => {
                const nombre = (e.profesionalId && nombres.get(e.profesionalId)) ?? 'Profesional del centro';
                return (
                  <li key={e.id} className={`rounded-[18px] border bg-bg px-[18px] py-4 ${e.avisadaEn ? 'border-accent-500' : 'border-divider'}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-[1_1_200px]">
                        <p className="m-0 text-[14.5px] font-black tracking-[-0.015em]">{nombre}</p>
                        <p className="m-0 text-[13px] font-semibold text-neutral-700">
                          Desde el {formatoFechaLarga(e.creadaEn)}
                          {e.preferencias ? ` · ${e.preferencias}` : ''}
                        </p>
                      </div>
                      <Button variant="ghost" loading={salir.isPending && salir.variables === e.id} onClick={() => salir.mutate(e.id)} className="!py-2">
                        Salir de la lista
                      </Button>
                    </div>
                    {e.avisadaEn && e.profesionalId && (
                      <div className="mt-3.5 flex flex-wrap items-center gap-3 border-t border-divider pt-3.5">
                        <Icon name="notifications_active" size={19} className="text-accent-700" />
                        <span className="flex-[1_1_180px] text-[13px] font-bold text-accent-900">
                          Se liberó una hora ({formatoFechaHora(e.avisadaEn)}). Las horas se toman por orden de llegada.
                        </span>
                        <ButtonLink href={`/pedir-hora/${e.profesionalId}`} variant="team" icon="calendar_month" className="!py-2.5">
                          Ver horas
                        </ButtonLink>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
      </Panel>

      <Panel titulo="Anotarme en una lista" bajada="Si no encuentras una hora que te acomode, espera la próxima que se libere.">
        <form onSubmit={enviar} className="flex flex-col gap-3.5" noValidate>
          <Field label="Profesional" required>
            {(p) => (
              <Select {...p} value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
                <option value="">Elige un profesional</option>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Preferencias (opcional)" hint="Días u horarios que te acomodan. No incluyas detalles clínicos.">
            {(p) => <Textarea {...p} rows={2} maxLength={500} value={preferencias} onChange={(e) => setPreferencias(e.target.value)} className="!min-h-20" />}
          </Field>
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" icon="notifications_active" loading={inscribir.isPending}>
              Avisarme cuando haya hora
            </Button>
          </div>
          <Aviso tono="nota" icono="info">
            Estar en la lista no reserva una hora: cuando te avisemos, elige la que te acomode antes que otra persona.
          </Aviso>
        </form>
      </Panel>
    </div>
  );
}
