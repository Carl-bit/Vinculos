'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { api } from '@/lib/api/cliente';
import { mensajeError } from '@/lib/api/errores';

/**
 * Reporte publico de una reseña (sin cuenta, con limite por IP en la API):
 * llega a la moderacion de administracion, que decide si la oculta. No
 * cambia nada al instante.
 */
export function ReportarResena({ resenaId }: { resenaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [estado, setEstado] = useState<'listo' | 'enviando' | { error: string } | null>(null);
  const enviar = async () => {
    setEstado('enviando');
    const { response, error } = await api.POST('/api/publico/resenas/{id}/reporte', { params: { path: { id: resenaId } }, body: { motivo: motivo.trim() } });
    setEstado(response.ok ? 'listo' : { error: mensajeError(response.status, (error ?? {}) as Parameters<typeof mensajeError>[1]) });
  };
  if (estado === 'listo')
    return (
      <p role="status" className="m-0 mt-2 text-[12.5px] font-bold text-accent-2-800">
        Gracias: el centro revisará esta valoración.
      </p>
    );
  if (!abierto)
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-1 min-h-10 cursor-pointer text-[12.5px] font-extrabold text-neutral-800 underline underline-offset-2 hover:text-accent-700"
      >
        Reportar valoración
      </button>
    );
  return (
    <div className="mt-2 flex flex-col gap-2.5">
      <Field label="¿Qué problema tiene?" hint="Por ejemplo, datos personales o un comentario ofensivo. Lo revisa el centro.">
        {(p) => <Textarea {...p} rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} className="!min-h-16" />}
      </Field>
      {typeof estado === 'object' && estado && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {estado.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setAbierto(false)} className="!py-2">
          Cancelar
        </Button>
        <Button variant="secondary" disabled={motivo.trim().length < 3} loading={estado === 'enviando'} onClick={() => void enviar()} className="!py-2">
          Enviar reporte
        </Button>
      </div>
    </div>
  );
}
