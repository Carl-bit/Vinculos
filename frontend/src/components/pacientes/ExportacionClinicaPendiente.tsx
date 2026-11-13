'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useExportacionesPendientes } from '@/lib/exportaciones';
import { formatoFecha } from '@/lib/formato';

/**
 * AUD-01 Fase 3: el paciente pidio una copia de sus datos y el centro preparo
 * la parte administrativa. El tratante genera la clinica (administracion no
 * la ve); al hacerlo, el paciente recibe el enlace en su correo registrado.
 */
export function ExportacionClinicaPendiente({ pacienteId, tratante }: { pacienteId: string; tratante: boolean }) {
  const cliente = useQueryClient();
  const pendientes = useExportacionesPendientes(tratante);
  const [error, setError] = useState<string>();
  const generar = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/exportaciones/{id}/clinica', { params: { path: { id } } })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['exportaciones'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos generar la parte clínica.'),
  });
  const e = pendientes.data?.find((x) => x.pacienteId === pacienteId);
  if (!tratante || !e) return null;
  return (
    <Aviso
      tono="advertencia"
      icono="description"
      titulo="El paciente pidió una copia de sus datos"
      accion={
        <Button variant="team" loading={generar.isPending} onClick={() => generar.mutate(e.id)}>
          Generar la parte clínica y enviar
        </Button>
      }
    >
      Administración preparó la parte administrativa el {formatoFecha(e.creadaEn)}. Falta la ficha (ingreso, evoluciones, documentos y
      adjuntos), que solo genera el tratante. Al generarla, el paciente recibe un enlace en su correo registrado que vence en 72 horas.
      {error && <span role="alert" className="mt-2 block font-bold text-accent-700">{error}</span>}
    </Aviso>
  );
}
