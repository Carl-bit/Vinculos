'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

/**
 * Sala de videollamada y calendario externo (02h): enlace propio (cifrado) o
 * sala Jitsi por cita, y un feed iCal privado para Google o Apple Calendar.
 * La URL del feed se muestra una sola vez; regenerarla invalida la anterior.
 */
export function IntegracionesAgenda() {
  const sala = useQuery({ queryKey: ['agenda', 'sala'], queryFn: () => datos(api.GET('/api/profesionales/yo/videollamada')) });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel titulo="Sala de videollamada" bajada="Para las sesiones online. El enlace llega al paciente con la confirmación.">
        <div className="mt-4">
          <EstadoConsulta consulta={sala}>{(s) => <Sala key={`${s.modo}-${s.enlace ?? ''}`} modo={s.modo} enlace={s.enlace} />}</EstadoConsulta>
        </div>
      </Panel>
      <Calendario />
    </div>
  );
}

function Sala({ modo: inicial, enlace: enlaceInicial }: { modo: 'ENLACE_PROPIO' | 'JITSI'; enlace: string | null }) {
  const cliente = useQueryClient();
  const [modo, setModo] = useState(inicial);
  const [enlace, setEnlace] = useState(enlaceInicial ?? '');
  const [estado, setEstado] = useState<{ error?: string; ok?: boolean }>({});
  const guardar = useMutation({
    mutationFn: () => datos(api.PUT('/api/profesionales/yo/videollamada', { body: { modo, enlace: modo === 'ENLACE_PROPIO' ? enlace.trim() : undefined } })),
    onSuccess: () => {
      setEstado({ ok: true });
      void cliente.invalidateQueries({ queryKey: ['agenda', 'sala'] });
    },
    onError: (e) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar la sala.' }),
  });
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Tipo de sala" className="flex flex-wrap gap-2">
        {(
          [
            ['ENLACE_PROPIO', 'Mi enlace (Meet, Zoom…)'],
            ['JITSI', 'Sala Jitsi por cita'],
          ] as const
        ).map(([v, t]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={modo === v}
            onClick={() => setModo(v)}
            className={`min-h-10 cursor-pointer rounded-full border-[1.5px] px-4 text-[13px] font-extrabold transition-colors duration-200 ${
              modo === v ? 'border-accent-700 bg-accent-200 text-accent-900' : 'border-neutral-400 bg-bg hover:border-accent-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {modo === 'ENLACE_PROPIO' ? (
        <Field label="Enlace de tu sala" hint="https://… Se guarda cifrado.">
          {(x) => <Input {...x} type="url" value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="https://meet.google.com/…" />}
        </Field>
      ) : (
        <p className="m-0 text-[13px] font-semibold text-neutral-800">Cada cita online recibe una sala nueva, sin que tengas que configurar nada.</p>
      )}
      {estado.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {estado.error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {estado.ok && (
          <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
            Sala guardada.
          </p>
        )}
        <Button variant="team" icon="save" disabled={modo === 'ENLACE_PROPIO' && !enlace.trim()} loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar sala
        </Button>
      </div>
    </div>
  );
}

function Calendario() {
  const [url, setUrl] = useState<string>();
  const [copiado, setCopiado] = useState(false);
  const generar = useMutation({ mutationFn: () => datos(api.POST('/api/profesionales/yo/calendario')), onSuccess: (r) => setUrl(r.url) });
  return (
    <Panel titulo="Calendario externo" bajada="Suscríbete desde Google o Apple Calendar para ver tus sesiones (sin nombres de pacientes).">
      <div className="mt-4 flex flex-col gap-3">
        {url ? (
          <>
            <Aviso tono="advertencia" titulo="Guárdala ahora">
              Esta dirección se muestra una sola vez. Quien la tenga ve tu agenda: no la compartas.
            </Aviso>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="URL del calendario"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                className="!min-w-[220px] flex-1 !py-2 !text-[13px]"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).then(() => setCopiado(true));
                }}
                className="!py-2.5"
              >
                {copiado ? 'Copiada' : 'Copiar'}
              </Button>
            </div>
          </>
        ) : (
          <p className="m-0 text-[13px] font-semibold text-neutral-800">Si ya generaste una y la perdiste, genera otra: la anterior deja de funcionar.</p>
        )}
        {generar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {generar.error instanceof ApiError ? generar.error.message : 'No pudimos generar el calendario.'}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" icon="calendar_month" loading={generar.isPending} onClick={() => generar.mutate()}>
            {url ? 'Generar otra' : 'Generar dirección'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
