'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Bloque } from '@/lib/horarios';

import { igual, NOMBRE_MODALIDAD_CITA, SelectorHorario } from './SelectorHorario';

/** Horas que se pueden proponer de una vez (la BD exige de 1 a 5). */
const MAX_PROPUESTAS = 5;

/**
 * MVP sin cobros: el profesional aprueba o rechaza la hora que pidio su
 * paciente (cita SOLICITADA). Lo usan el inicio y el detalle de la cita.
 * Mientras responde la API los botones quedan bloqueados.
 *
 * Correcciones 2026-11-11 (punto 7): "No puedo en ese horario" abre su agenda
 * para proponer de 1 a 5 horas libres. Quedan bloqueadas (PROPUESTA) hasta que
 * el paciente elige una o pide otra; tambien se puede rechazar sin proponer.
 */
export function AprobarSolicitud({ citaId, onListo }: { citaId: string; onListo?: () => void }) {
  const cliente = useQueryClient();
  const yo = useMiCuenta().data?.id;
  const [proponiendo, setProponiendo] = useState(false);
  const [elegidas, setElegidas] = useState<Bloque[]>([]);
  const decidir = useMutation({
    mutationFn: (d: { aprobar: boolean; alternativas?: Bloque[] }) =>
      datos(
        api.PATCH('/api/citas/{id}/aprobacion', {
          params: { path: { id: citaId } },
          body: {
            aprobar: d.aprobar,
            alternativas: d.alternativas?.map((b) => ({ modalidad: b.modalidad, inicio: b.inicio.toISOString(), fin: b.fin.toISOString() })),
          },
        }),
      ),
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: ['panel'] });
      void cliente.invalidateQueries({ queryKey: ['huecos'] });
    },
    onSuccess: () => {
      setProponiendo(false);
      onListo?.();
    },
  });
  const ocupado = decidir.isPending;
  const error = decidir.isError && (decidir.error instanceof ApiError ? decidir.error.message : 'No pudimos guardar la respuesta.');
  // Elegir una hora ya elegida la quita (mismo gesto que en las listas del panel).
  const alternar = (b: Bloque) => setElegidas((l) => (l.some((x) => igual(x, b)) ? l.filter((x) => !igual(x, b)) : l.length < MAX_PROPUESTAS ? [...l, b] : l));

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="!py-2" icon="event_repeat" disabled={ocupado} onClick={() => setProponiendo(true)}>
          No puedo en ese horario
        </Button>
        <Button
          variant="team"
          className="!py-2"
          icon="check"
          disabled={ocupado}
          loading={ocupado && decidir.variables?.aprobar === true}
          onClick={() => decidir.mutate({ aprobar: true })}
        >
          Aprobar
        </Button>
      </div>
      {error && !proponiendo && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <Modal
        abierto={proponiendo}
        onCerrar={() => !ocupado && setProponiendo(false)}
        titulo="Proponer otras horas"
        descripcion={`Elige hasta ${MAX_PROPUESTAS} horas libres de tu agenda. Quedan guardadas para tu paciente hasta que elija una; si ninguna le acomoda, vuelve a pedir hora.`}
        ancho="lg"
      >
        <div className="flex flex-col gap-4">
          {yo && (
            <SelectorHorario
              equipo
              profesionalId={yo}
              valor={null}
              onElegir={alternar}
              sinHoras={<p className="m-0 text-[13.5px] font-semibold text-neutral-800">No tienes horas libres en las próximas semanas.</p>}
            />
          )}
          {elegidas.length > 0 && (
            <ul aria-label="Horas que vas a proponer" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {elegidas.map((b) => (
                <li key={`${b.modalidad}-${b.inicio.toISOString()}`}>
                  <button
                    type="button"
                    onClick={() => alternar(b)}
                    aria-label={`Quitar ${formatoFechaLarga(b.inicio)} ${formatoHora(b.inicio)}`}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-accent-2-500 bg-accent-2-200 px-3 text-[12.5px] font-extrabold text-accent-2-900 hover:bg-accent-2-300"
                  >
                    <span className="first-letter:uppercase">
                      {formatoFechaLarga(b.inicio)}, {formatoHora(b.inicio)} · {NOMBRE_MODALIDAD_CITA[b.modalidad]}
                    </span>
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2.5">
            <Button
              variant="ghost"
              icon="close"
              disabled={ocupado}
              loading={ocupado && decidir.variables?.aprobar === false && !decidir.variables.alternativas}
              onClick={() => decidir.mutate({ aprobar: false })}
            >
              Rechazar sin proponer
            </Button>
            <Button
              variant="team"
              icon="send"
              disabled={ocupado || elegidas.length === 0}
              loading={ocupado && !!decidir.variables?.alternativas}
              onClick={() => decidir.mutate({ aprobar: false, alternativas: elegidas })}
            >
              {elegidas.length === 1 ? 'Proponer 1 hora' : `Proponer ${elegidas.length || ''} horas`.replace('  ', ' ')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
