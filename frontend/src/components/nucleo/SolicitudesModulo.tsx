'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora } from '@/lib/formato';

export type SolicitudModulo = components['schemas']['SolicitudModuloVista'];
type Modulo = components['schemas']['ModuloCentro'];
type Accion = components['schemas']['AccionModulo'];

const ABIERTAS = ['PENDIENTE', 'APROBADA'];

export const ESTADO_SOLICITUD: Record<SolicitudModulo['estado'], { texto: string; tono: 'neutro' | 'positivo' | 'atencion' }> = {
  PENDIENTE: { texto: 'Solicitud enviada', tono: 'atencion' },
  APROBADA: { texto: 'Aprobada, en preparación', tono: 'positivo' },
  RECHAZADA: { texto: 'No aprobada', tono: 'neutro' },
  APLICADA: { texto: 'Aplicada', tono: 'positivo' },
};

/** Tarea 31: solicitudes del centro (las aplica Vinculos; la consulta se refresca con el polling global). */
export function useSolicitudesModulo() {
  return useQuery({ queryKey: ['configuracion', 'solicitudes-modulo'], queryFn: () => datos(api.GET('/api/configuracion/solicitudes-modulo')) });
}

/** Solicitud abierta (pendiente o aprobada) de un modulo, si existe. */
export const abiertaDe = (lista: SolicitudModulo[] | undefined, modulo: Modulo) => lista?.find((s) => s.modulo === modulo && ABIERTAS.includes(s.estado));

/**
 * Requisito que falta para pedir (mismas reglas que solicitar_modulo() en la
 * BD): MATCH y la pagina publica requieren Equipo; no se desactiva Equipo con
 * MATCH o la pagina publica activos. null = se puede pedir.
 */
export function bloqueoSolicitud(modulo: Modulo, accion: Accion, activos: Modulo[]): string | null {
  if (accion === 'ACTIVAR' && (modulo === 'MATCH' || modulo === 'PAGINA_PUBLICA') && !activos.includes('EQUIPO')) {
    return 'Requiere el módulo Equipo: solicítalo primero.';
  }
  if (accion === 'DESACTIVAR' && modulo === 'EQUIPO' && (activos.includes('MATCH') || activos.includes('PAGINA_PUBLICA'))) {
    return 'Match y la página pública dependen de Equipo: pide desactivarlos primero.';
  }
  return null;
}

/** Boton "Solicitar" / "Solicitar desactivar" con motivo opcional, o el estado de la solicitud abierta. */
export function AccionSolicitud({
  modulo,
  nombre,
  activo,
  activos,
  abierta,
}: {
  modulo: Modulo;
  nombre: string;
  activo: boolean;
  activos: Modulo[];
  abierta?: SolicitudModulo;
}) {
  const cliente = useQueryClient();
  const [abiertoForm, setAbiertoForm] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const accion: Accion = activo ? 'DESACTIVAR' : 'ACTIVAR';
  const pedir = useMutation({
    mutationFn: () =>
      datos(api.POST('/api/configuracion/solicitudes-modulo', { body: { modulo, accion, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) } })),
    onSuccess: () => {
      setAbiertoForm(false);
      setMotivo('');
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['configuracion', 'solicitudes-modulo'] });
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos enviar la solicitud.'),
  });

  if (abierta) {
    const e = ESTADO_SOLICITUD[abierta.estado];
    return <Badge tono={e.tono}>{`${e.texto}${abierta.accion === 'DESACTIVAR' ? ' (desactivar)' : ''}`}</Badge>;
  }
  const bloqueo = bloqueoSolicitud(modulo, accion, activos);
  if (!abiertoForm) {
    return (
      <button
        type="button"
        disabled={!!bloqueo}
        title={bloqueo ?? undefined}
        onClick={() => setAbiertoForm(true)}
        className="min-h-9 cursor-pointer rounded-full border border-divider bg-surface px-3.5 text-[13px] font-extrabold disabled:cursor-not-allowed disabled:opacity-60"
      >
        {activo ? 'Solicitar desactivar' : 'Solicitar'}
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <Field
        label="Para qué lo necesitan (opcional)"
        hint={`Queda en el centro; Vinculos solo recibe que se pidió ${activo ? 'desactivar' : 'activar'} ${nombre}.`}
      >
        {(p) => <Textarea {...p} rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Field>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setAbiertoForm(false)}>
          Cancelar
        </Button>
        <Button variant="team" loading={pedir.isPending} onClick={() => pedir.mutate()}>
          Enviar solicitud
        </Button>
      </div>
    </div>
  );
}

/** Historial corto: lo que respondio Vinculos. */
export function HistorialSolicitudes({ lista, nombre }: { lista: SolicitudModulo[]; nombre: (m: string) => string }) {
  if (!lista.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <p className="m-0 text-[12px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Solicitudes recientes</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {lista.slice(0, 6).map((s) => {
          const e = ESTADO_SOLICITUD[s.estado];
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <strong>{`${s.accion === 'ACTIVAR' ? 'Activar' : 'Desactivar'} ${nombre(s.modulo)}`}</strong>
              <span className="text-neutral-700">{formatoFechaHora(s.pedidaEn)}</span>
              <Badge tono={e.tono}>{e.texto}</Badge>
              {s.respuesta && <span className="w-full text-neutral-700">Vinculos: {s.respuesta}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
