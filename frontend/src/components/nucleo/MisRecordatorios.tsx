'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFecha } from '@/lib/formato';
import { fechaHoyChile } from '@/lib/panel';

const CLAVE = ['mis-recordatorios'];

/**
 * Mis recordatorios (03b-4.2): lista de tareas personales del inicio. Solo
 * la ve su autor (RLS); el texto se guarda cifrado. No es la ficha: no se
 * escriben datos clinicos (la pantalla lo advierte).
 */
export function MisRecordatorios() {
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: CLAVE, queryFn: () => datos(api.GET('/api/mis-recordatorios')) });
  const [texto, setTexto] = useState('');
  const [fecha, setFecha] = useState('');
  const [error, setError] = useState<string>();
  const refrescar = () => void cliente.invalidateQueries({ queryKey: CLAVE });
  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el recordatorio.');
  const crear = useMutation({
    mutationFn: () => datos(api.POST('/api/mis-recordatorios', { body: { texto: texto.trim(), venceEl: fecha || undefined } })),
    onSuccess: () => {
      setTexto('');
      setFecha('');
      setError(undefined);
      refrescar();
    },
    onError: fallo,
  });
  const marcar = useMutation({
    mutationFn: (r: { id: string; hecho: boolean }) =>
      datos(api.PATCH('/api/mis-recordatorios/{id}', { params: { path: { id: r.id } }, body: { hecho: r.hecho } })),
    onSuccess: refrescar,
    onError: fallo,
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.DELETE('/api/mis-recordatorios/{id}', { params: { path: { id } } }),
    onSuccess: refrescar,
    onError: fallo,
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    crear.mutate();
  };
  const hoy = fechaHoyChile();

  return (
    <section aria-labelledby="mis-recordatorios" className="rounded-lg border border-divider bg-bg px-5 pt-4 pb-5 shadow-md">
      <h2 id="mis-recordatorios" className="m-0 text-[17px] font-black tracking-[-0.02em]">
        Mis recordatorios
      </h2>
      <p className="m-0 mt-0.5 mb-3 text-[12.5px] font-semibold text-neutral-700">Solo los ves tú. No escribas datos clínicos aquí: van en la ficha.</p>
      <form onSubmit={enviar} className="mb-3 flex flex-wrap gap-2">
        <Input
          aria-label="Nuevo recordatorio"
          placeholder="Ej.: llamar al colegio de turno"
          maxLength={300}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="!min-h-10 min-w-0 flex-[1_1_200px] !py-2 !text-[13.5px]"
        />
        <Input
          aria-label="Fecha (opcional)"
          type="date"
          min={hoy}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="!min-h-10 !w-auto !py-2 !text-[13px]"
        />
        <Button type="submit" variant="team" icon="add" loading={crear.isPending} disabled={!texto.trim()} className="!min-h-10 !py-2 !text-[13px]">
          Agregar
        </Button>
      </form>
      {error && (
        <p role="alert" className="m-0 mb-2 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Sin recordatorios">
        {(l) => (
          <ul className="m-0 flex list-none flex-col p-0">
            {l.map((r) => {
              const hecho = !!r.hechoEn;
              const vencido = !hecho && !!r.venceEl && r.venceEl < hoy;
              return (
                <li key={r.id} className="flex items-center gap-2 border-b border-divider py-1.5 last:border-b-0">
                  <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={hecho}
                      onChange={() => marcar.mutate({ id: r.id, hecho: !hecho })}
                      className="size-[18px] flex-none cursor-pointer accent-[var(--color-accent-700)]"
                    />
                    <span className={`min-w-0 flex-1 text-[13.5px] font-bold ${hecho ? 'text-neutral-700 line-through' : ''}`}>{r.texto}</span>
                    {r.venceEl && (
                      <span className={`flex-none text-[12px] font-extrabold tabular-nums ${vencido ? 'text-accent-700' : 'text-neutral-700'}`}>
                        {vencido && <span className="sr-only">Vencido: </span>}
                        {formatoFecha(r.venceEl)}
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    aria-label={`Borrar recordatorio: ${r.texto}`}
                    onClick={() => borrar.mutate(r.id)}
                    className="grid size-9 flex-none cursor-pointer place-items-center rounded-full text-neutral-700 hover:bg-accent-100 hover:text-accent-700"
                  >
                    <Icon name="delete" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </EstadoConsulta>
    </section>
  );
}
