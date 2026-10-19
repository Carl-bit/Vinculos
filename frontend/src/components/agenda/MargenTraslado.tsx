'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Casilla } from '@/components/ui/Casilla';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { usePerfilProfesional } from '@/lib/equipo';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';

const claveConflictos = (id: string) => ['panel', 'conflictos-margen', id];

/** Citas futuras que no cumplen el margen de traslado vigente (no se mueven solas). */
export function useConflictosMargen(profesionalId: string) {
  return useQuery({
    queryKey: claveConflictos(profesionalId),
    queryFn: () => datos(api.GET('/api/profesionales/{profesionalId}/conflictos-margen', { params: { path: { profesionalId } } })),
  });
}

/**
 * Margen de traslado entre una sesion presencial y una online del mismo
 * profesional (C-3): propio del profesional o el del centro. Cambiarlo no
 * mueve citas: las que quedan en conflicto se listan para reprogramarlas.
 */
export function MargenTraslado({
  abierto,
  onCerrar,
  profesionalId,
  nombre,
}: {
  abierto: boolean;
  onCerrar: () => void;
  profesionalId: string;
  nombre: string;
}) {
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={`Margen de traslado de ${nombre}`}>
      {abierto && <FormularioMargen profesionalId={profesionalId} onListo={onCerrar} />}
    </Modal>
  );
}

function FormularioMargen({ profesionalId, onListo }: { profesionalId: string; onListo: () => void }) {
  const cliente = useQueryClient();
  const perfil = usePerfilProfesional(profesionalId);
  const conflictos = useConflictosMargen(profesionalId);
  const actual = perfil.data?.margenTrasladoMin ?? null;
  const [propio, setPropio] = useState<boolean | null>(null);
  const [minutos, setMinutos] = useState<string | null>(null);
  const usaPropio = propio ?? actual !== null;
  const valor = minutos ?? (actual !== null ? String(actual) : '30');
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/profesionales/{id}/margen', { params: { path: { id: profesionalId } }, body: { margenTrasladoMin: usaPropio ? Number(valor) : null } }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', profesionalId] });
      void cliente.invalidateQueries({ queryKey: claveConflictos(profesionalId) });
    },
  });
  const numero = Number(valor);
  const valido = !usaPropio || (Number.isInteger(numero) && numero >= 0 && numero <= 600);
  if (perfil.isSuccess && !perfil.data)
    return <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Todavía no tiene perfil profesional: el margen se define después de crearlo.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        Tiempo mínimo entre una sesión presencial y una online (en cualquier orden). Cambiarlo no mueve las horas ya agendadas.
      </p>
      <Casilla checked={!usaPropio} onChange={(v) => setPropio(!v)}>
        Usar el margen del centro (Configuración › Reglas y plazos)
      </Casilla>
      {usaPropio && (
        <Field label="Margen propio (minutos)" hint="Entre 0 y 600.">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={600}
              inputMode="numeric"
              value={valor}
              onChange={(e) => setMinutos(e.target.value)}
              className="!max-w-[180px]"
            />
          )}
        </Field>
      )}
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar el margen.'}
        </p>
      )}
      {guardar.isSuccess && (
        <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
          Margen guardado.
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="team" icon="save" disabled={!valido} loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar margen
        </Button>
      </div>
      <div className="border-t border-divider pt-4">
        <p className="m-0 mb-2 text-xs font-extrabold text-neutral-700">Horas que no cumplen el margen</p>
        <EstadoConsulta consulta={conflictos} vacio={(l) => l.length === 0} textoVacio="Ninguna hora en conflicto">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {lista.map((c) => (
                <li key={`${c.cita_id}-${c.cita_conflicto_id}`} className="text-[13.5px] font-semibold text-neutral-800">
                  {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)}: {c.separacion_min} min entre sesiones (pide {c.margen_min})
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
        {(conflictos.data?.length ?? 0) > 0 && (
          <ButtonLink href="/admin/agenda" variant="secondary" className="mt-3 !py-2.5" onClick={onListo}>
            Reprogramar en el calendario
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
