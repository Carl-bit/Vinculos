'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora } from '@/lib/formato';

const MAX_COMENTARIO = 4000;

/**
 * Comentarios de supervision de una evolucion (append-only). Los escribe el
 * supervisor vigente; los leen el y el tratante actual (el practicante autor).
 */
export function ComentariosSupervision({ evolucionId, puedeComentar }: { evolucionId: string; puedeComentar: boolean }) {
  const cliente = useQueryClient();
  const comentarios = useQuery({
    queryKey: ['supervision', 'comentarios', evolucionId],
    queryFn: () => datos(api.GET('/api/evoluciones/{id}/comentarios', { params: { path: { id: evolucionId } } })),
  });
  const [texto, setTexto] = useState('');
  const comentar = useMutation({
    mutationFn: () =>
      datos(api.POST('/api/supervision/evoluciones/{id}/comentarios', { params: { path: { id: evolucionId } }, body: { texto: texto.trim() } })),
    onSuccess: () => {
      setTexto('');
      void cliente.invalidateQueries({ queryKey: ['supervision', 'comentarios', evolucionId] });
    },
  });
  const lista = comentarios.data ?? [];
  return (
    <div className="mt-3.5 flex flex-col gap-2.5 border-t border-divider pt-3">
      <p className="m-0 text-xs font-extrabold text-neutral-700">Comentarios de supervisión</p>
      {comentarios.isPending ? (
        <span aria-hidden="true" className="esqueleto block h-6 rounded" />
      ) : lista.length === 0 ? (
        <p className="m-0 text-[13px] font-semibold text-neutral-700">Sin comentarios.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {lista.map((c) => (
            <li key={c.id} className="border-b border-divider pb-2 last:border-b-0 last:pb-0">
              <p className="m-0 text-[14px] font-semibold whitespace-pre-line text-pretty">{c.texto}</p>
              <p className="m-0 text-xs font-semibold text-neutral-700">{formatoFechaHora(c.creadoEn)}</p>
            </li>
          ))}
        </ul>
      )}
      {puedeComentar && (
        <div className="flex flex-col gap-2">
          <Field label="Nuevo comentario" hint="Queda registrado y no se edita. No escribas datos identificatorios.">
            {(p) => <Textarea {...p} rows={2} maxLength={MAX_COMENTARIO} value={texto} onChange={(ev) => setTexto(ev.target.value)} className="!min-h-16" />}
          </Field>
          {comentar.error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {comentar.error instanceof ApiError ? comentar.error.message : 'No pudimos guardar el comentario.'}
            </p>
          )}
          <div>
            <Button variant="secondary" icon="send" disabled={!texto.trim()} loading={comentar.isPending} onClick={() => comentar.mutate()} className="!py-2.5">
              Comentar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
