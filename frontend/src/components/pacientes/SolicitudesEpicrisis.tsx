'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora } from '@/lib/formato';

type Solicitud = components['schemas']['SolicitudEpicrisisPortal'];

const ESTADO: Record<Solicitud['estado'], { texto: string; tono: 'positivo' | 'atencion' | 'neutro' }> = {
  SOLICITADA: { texto: 'Por atender', tono: 'atencion' },
  EN_PROCESO: { texto: 'En proceso', tono: 'atencion' },
  ENTREGADA: { texto: 'Entregada', tono: 'positivo' },
  RECHAZADA: { texto: 'Rechazada', tono: 'neutro' },
};

/**
 * Solicitudes de copia de la ficha (epicrisis, derecho de acceso de la Ley
 * 20.584) que el paciente hace desde el portal. Las resuelve el tratante o
 * ADMIN: en proceso, entregada (con la referencia del documento emitido o
 * entregado) o rechazada. Sin respuesta in-app: el paciente ve el estado.
 */
export function SolicitudesEpicrisis({ pacienteId, puedeResolver }: { pacienteId: string; puedeResolver: boolean }) {
  const solicitudes = useQuery({ queryKey: ['panel', 'epicrisis'], queryFn: () => datos(api.GET('/api/epicrisis')) });
  const lista = (solicitudes.data ?? []).filter((s) => s.pacienteId === pacienteId);
  if (!lista.length) return null;
  return (
    <Panel
      titulo="Solicitudes de copia de la ficha"
      bajada="Las pide el paciente desde su cuenta. Se entregan como documento emitido o por otro medio, y queda la referencia."
    >
      <ul className="m-0 mt-4 flex list-none flex-col p-0">
        {lista.map((s) => (
          <FilaSolicitud key={s.id} solicitud={s} puedeResolver={puedeResolver} />
        ))}
      </ul>
    </Panel>
  );
}

function FilaSolicitud({ solicitud: s, puedeResolver }: { solicitud: Solicitud; puedeResolver: boolean }) {
  const cliente = useQueryClient();
  const [entregar, setEntregar] = useState(false);
  const [referencia, setReferencia] = useState('');
  const resolver = useMutation({
    mutationFn: (estado: 'EN_PROCESO' | 'ENTREGADA' | 'RECHAZADA') =>
      datos(
        api.POST('/api/epicrisis/{id}/resolucion', {
          params: { path: { id: s.id } },
          body: { estado, documentoRef: estado === 'ENTREGADA' ? referencia.trim() : undefined },
        }),
      ),
    onSuccess: () => {
      setEntregar(false);
      void cliente.invalidateQueries({ queryKey: ['panel', 'epicrisis'] });
    },
  });
  const abierta = s.estado === 'SOLICITADA' || s.estado === 'EN_PROCESO';
  return (
    <li className="flex flex-col gap-2.5 border-b border-divider py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
            Pedida el {formatoFechaHora(s.solicitadaEn)}
            <Badge tono={ESTADO[s.estado].tono}>{ESTADO[s.estado].texto}</Badge>
          </p>
          {s.motivo && <p className="m-0 text-[13px] font-semibold text-neutral-800">Motivo: {s.motivo}</p>}
          {s.documentoRef && <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Entregada: {s.documentoRef}</p>}
        </div>
        {puedeResolver && abierta && !entregar && (
          <div className="flex flex-wrap gap-2">
            {s.estado === 'SOLICITADA' && (
              <Button
                variant="ghost"
                loading={resolver.isPending && resolver.variables === 'EN_PROCESO'}
                onClick={() => resolver.mutate('EN_PROCESO')}
                className="!px-3.5 !py-2 !text-[13px]"
              >
                En proceso
              </Button>
            )}
            <Button
              variant="ghost"
              loading={resolver.isPending && resolver.variables === 'RECHAZADA'}
              onClick={() => resolver.mutate('RECHAZADA')}
              className="!px-3.5 !py-2 !text-[13px]"
            >
              Rechazar
            </Button>
            <Button variant="secondary" icon="task_alt" onClick={() => setEntregar(true)} className="!px-4 !py-2 !text-[13px]">
              Entregada
            </Button>
          </div>
        )}
      </div>
      {entregar && (
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[240px] flex-1">
            <Field label="Referencia de la entrega" required hint="Ej.: documento emitido el 18-10, o entregado en papel en recepción.">
              {(p) => <Input {...p} maxLength={500} value={referencia} onChange={(e) => setReferencia(e.target.value)} className="!py-2.5" />}
            </Field>
          </div>
          <Button variant="ghost" onClick={() => setEntregar(false)} className="mb-[26px]">
            Volver
          </Button>
          <Button variant="team" disabled={!referencia.trim()} loading={resolver.isPending} onClick={() => resolver.mutate('ENTREGADA')} className="mb-[26px]">
            Registrar entrega
          </Button>
        </div>
      )}
      {resolver.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {resolver.error instanceof ApiError ? resolver.error.message : 'No pudimos registrar el cambio.'}
        </p>
      )}
    </li>
  );
}
