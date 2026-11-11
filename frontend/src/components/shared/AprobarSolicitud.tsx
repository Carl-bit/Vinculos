'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

/**
 * MVP sin cobros: el profesional aprueba o rechaza la hora que pidio su
 * paciente (cita SOLICITADA). Lo usan el inicio y el detalle de la cita.
 * Mientras responde la API los dos botones quedan bloqueados.
 */
export function AprobarSolicitud({ citaId, onListo }: { citaId: string; onListo?: () => void }) {
  const cliente = useQueryClient();
  const decidir = useMutation({
    mutationFn: (aprobar: boolean) =>
      datos(api.PATCH('/api/citas/{id}/aprobacion', { params: { path: { id: citaId } }, body: { aprobar } })),
    onSettled: () => void cliente.invalidateQueries({ queryKey: ['panel'] }),
    onSuccess: () => onListo?.(),
  });
  const ocupado = decidir.isPending;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          className="!py-2"
          icon="close"
          disabled={ocupado}
          loading={ocupado && decidir.variables === false}
          onClick={() => decidir.mutate(false)}
        >
          Rechazar
        </Button>
        <Button
          variant="team"
          className="!py-2"
          icon="check"
          disabled={ocupado}
          loading={ocupado && decidir.variables === true}
          onClick={() => decidir.mutate(true)}
        >
          Aprobar
        </Button>
      </div>
      {decidir.isError && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {decidir.error instanceof ApiError ? decidir.error.message : 'No pudimos guardar la respuesta.'}
        </p>
      )}
    </div>
  );
}
