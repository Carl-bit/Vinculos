'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { NOMBRE_MODALIDAD_CITA } from '@/components/shared/SelectorHorario';
import { Button } from '@/components/ui/Button';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { clavesPortal, type CitaPortal } from '@/lib/portal';

/**
 * Correcciones 2026-11-11 (punto 7): el profesional no pudo atender la hora
 * pedida y propuso otras (citas PROPUESTA del mismo grupo). Quedan guardadas
 * hasta el plazo: el paciente elige una (queda confirmada y las demas se
 * sueltan) o dice que ninguna le acomoda y vuelve a pedir hora.
 */
export function PropuestasHora({ propuestas, profesional }: { propuestas: CitaPortal[]; profesional: string }) {
  const cliente = useQueryClient();
  const router = useRouter();
  const responder = useMutation({
    mutationFn: (d: { id: string; aceptar: boolean }) =>
      datos(api.PATCH('/api/citas/{id}/propuesta', { params: { path: { id: d.id } }, body: { aceptar: d.aceptar } })),
    onSettled: () => void cliente.invalidateQueries({ queryKey: clavesPortal.todo }),
    // Ninguna le acomoda: vuelve a elegir entre las horas libres de su profesional.
    onSuccess: (_r, d) => !d.aceptar && router.push('/portal/pedir-hora'),
  });
  const vence = propuestas.reduce<string | null>((m, c) => (c.aprobacionVenceEn && (!m || c.aprobacionVenceEn < m) ? c.aprobacionVenceEn : m), null);
  const ocupado = responder.isPending;

  return (
    <section aria-labelledby={`propuestas-${propuestas[0].propuestaDeId}`} className="rounded-[18px] border border-accent-500 bg-accent-100 px-[18px] py-4">
      <h3 id={`propuestas-${propuestas[0].propuestaDeId}`} className="m-0 text-[15px] font-black tracking-[-0.015em]">
        {profesional} te propone otras horas
      </h3>
      <p className="m-0 mt-1 text-[13px] font-semibold text-pretty text-neutral-800">
        No puede atenderte en el horario que pediste. Elige una de estas horas{vence ? ` antes del ${formatoFechaHora(vence)}` : ''}: las guardamos para ti
        hasta entonces.
      </p>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {propuestas.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-bg px-3.5 py-2.5">
            <span className="min-w-0 flex-[1_1_180px] text-[14px] font-extrabold first-letter:uppercase">
              {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)} · {NOMBRE_MODALIDAD_CITA[c.modalidad]}
            </span>
            <Button
              variant="team"
              icon="check"
              className="!py-2 !text-[13px]"
              disabled={ocupado}
              loading={ocupado && responder.variables?.id === c.id && responder.variables.aceptar}
              onClick={() => responder.mutate({ id: c.id, aceptar: true })}
            >
              Elegir esta hora
            </Button>
          </li>
        ))}
      </ul>
      {responder.isError && (
        <p role="alert" className="m-0 mt-2.5 text-[13px] font-bold text-accent-700">
          {responder.error instanceof ApiError ? responder.error.message : 'No pudimos guardar tu respuesta. Intenta de nuevo.'}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <Button
          variant="ghost"
          icon="event_busy"
          className="!py-2 !text-[13px]"
          disabled={ocupado}
          loading={ocupado && !responder.variables?.aceptar}
          onClick={() => responder.mutate({ id: propuestas[0].id, aceptar: false })}
        >
          Ninguna me acomoda
        </Button>
      </div>
    </section>
  );
}
