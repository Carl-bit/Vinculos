'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useAltas } from '@/lib/fichas';
import { formatoFecha, formatoFechaHora } from '@/lib/formato';
import { fechaHoyChile } from '@/lib/panel';

/**
 * Alta del paciente (el tratante): fecha y motivo (cifrado). La ficha se
 * conserva (15 años desde la ultima atencion); se borran las respuestas del
 * cuestionario. Si vuelve, se sigue atendiendo
 * en la misma ficha.
 */
export function AltaPaciente({ pacienteId }: { pacienteId: string }) {
  const altas = useAltas(pacienteId, true);
  const cliente = useQueryClient();
  const [fecha, setFecha] = useState(fechaHoyChile);
  const [motivo, setMotivo] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const registrar = useMutation({
    mutationFn: () => datos(api.POST('/api/pacientes/{id}/alta', { params: { path: { id: pacienteId } }, body: { fecha, motivo: motivo.trim() } })),
    onSuccess: () => {
      setConfirmar(false);
      setMotivo('');
      void cliente.invalidateQueries({ queryKey: ['ficha', 'altas', pacienteId] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'estado-fichas'] });
    },
  });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="flex flex-col gap-4 rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-5">
        <h2 className="m-0 text-[16px] font-black">Registrar alta</h2>
        <Field label="Fecha del alta" required>
          {(p) => <Input {...p} type="date" max={fechaHoyChile()} value={fecha} onChange={(e) => setFecha(e.target.value)} />}
        </Field>
        <Field label="Motivo" required hint="Se guarda cifrado. Lo ve solo el equipo tratante.">
          {(p) => <Textarea {...p} rows={4} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Field>
        {confirmar ? (
          <div className="flex flex-col gap-3 rounded-lg border border-accent-500 bg-accent-100 px-4 py-3.5">
            <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
              Se registra el alta del {formatoFecha(fecha)}. La ficha se conserva, se borran las respuestas del cuestionario del sitio y se cierra su lista de
              espera. El registro no se edita.
            </p>
            {registrar.error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {registrar.error instanceof ApiError ? registrar.error.message : 'No pudimos registrar el alta.'}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmar(false)}>
                Volver
              </Button>
              <Button variant="team" icon="task_alt" loading={registrar.isPending} onClick={() => registrar.mutate()}>
                Registrar alta
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="team" icon="task_alt" disabled={!fecha || motivo.trim().length < 3} onClick={() => setConfirmar(true)}>
              Registrar alta
            </Button>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-[16px] font-black">Altas anteriores</h2>
        <EstadoConsulta consulta={altas} vacio={(l) => l.length === 0} textoVacio="Sin altas registradas">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {lista.map((a) => (
                <li key={a.id} className="rounded-lg border border-divider bg-neutral-100 px-4 py-3.5">
                  <p className="m-0 text-[14.5px] font-extrabold">Alta del {formatoFecha(a.fecha.slice(0, 10))}</p>
                  {a.motivo && <p className="m-0 mt-1 text-[14px] font-semibold whitespace-pre-line text-pretty">{a.motivo}</p>}
                  <p className="m-0 mt-1.5 text-xs font-semibold text-neutral-700">Registrada el {formatoFechaHora(a.creadaEn)}</p>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </section>
    </div>
  );
}
