'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Pestanas } from '@/components/ui/Pestanas';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFecha } from '@/lib/formato';
import { fechaHoyChile } from '@/lib/panel';

/**
 * AUD-01 (E2.3a): feriados que usan los plazos en dias habiles (solicitudes
 * de datos). Los nacionales de la ley los calcula el sistema cada año; el
 * ADMIN agrega los puntuales o regionales y puede quitar uno. Solo de hoy en
 * adelante: los plazos ya fijados no cambian.
 */
export function FeriadosCentro() {
  const cliente = useQueryClient();
  const hoy = fechaHoyChile();
  const actual = Number(hoy.slice(0, 4));
  const [anio, setAnio] = useState(actual);
  const feriados = useQuery({
    queryKey: ['feriados', anio],
    queryFn: () => datos(api.GET('/api/feriados', { params: { query: { anio } } })),
  });
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string>();
  const listo = (anioCambiado: number) => {
    setError(undefined);
    void cliente.invalidateQueries({ queryKey: ['feriados', anioCambiado] });
  };
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);
  const agregar = useMutation({
    mutationFn: (f: { fecha: string; nombre: string }) => datos(api.POST('/api/feriados', { body: f })),
    onSuccess: (_d, f) => {
      setFecha('');
      setNombre('');
      listo(Number(f.fecha.slice(0, 4)));
    },
    onError: fallo('No pudimos agregar el feriado.'),
  });
  const quitar = useMutation({
    mutationFn: (f: string) => datos(api.DELETE('/api/feriados/{fecha}', { params: { path: { fecha: f } } })),
    onSuccess: (_d, f) => listo(Number(f.slice(0, 4))),
    onError: fallo('No pudimos quitar el feriado.'),
  });
  const enviar = () => {
    if (!fecha || fecha < hoy) return setError('Elige una fecha de hoy en adelante.');
    if (nombre.trim().length < 2) return setError('Escribe el nombre del feriado.');
    agregar.mutate({ fecha, nombre: nombre.trim() });
  };

  // Proximos: los 3 siguientes no quitados (este año y, si hace falta, el siguiente).
  const siguiente = useQuery({
    queryKey: ['feriados', actual + 1],
    queryFn: () => datos(api.GET('/api/feriados', { params: { query: { anio: actual + 1 } } })),
  });
  const deEsteAnio = anio === actual ? feriados.data : undefined;
  const proximos = [...(deEsteAnio ?? []), ...(siguiente.data ?? [])].filter((f) => !f.quitado && f.fecha >= hoy).slice(0, 3);
  const [completo, setCompleto] = useState(false);

  return (
    <Panel titulo="Feriados" bajada="Los nacionales se calculan solos cada año. No cuentan como días hábiles en los plazos." nivel={3}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-extrabold text-neutral-700 uppercase">Próximos</span>
          {proximos.length === 0 && <span className="text-[13px] font-semibold text-neutral-700">Sin feriados próximos registrados.</span>}
          {proximos.map((f) => (
            <div key={f.fecha} className="flex justify-between gap-2 rounded-[10px] bg-bg px-2.5 py-2 text-[14px]">
              <span>
                {formatoFecha(f.fecha)} · {f.nombre}
              </span>
              <span className="text-[12px] font-semibold text-neutral-700">{f.origen === 'LEY' ? 'Ley' : 'Centro'}</span>
            </div>
          ))}
        </div>
        <Field label="Agregar feriado propio">
          {(p) => <Input {...p} type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} className="!py-2.5" />}
        </Field>
        <Input
          aria-label="Nombre del feriado"
          maxLength={120}
          value={nombre}
          placeholder="Ej.: Feriado regional de Arica"
          onChange={(e) => setNombre(e.target.value)}
          className="!py-2.5"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="team" loading={agregar.isPending} onClick={enviar} className="!py-2.5">
            Agregar feriado
          </Button>
          <button
            type="button"
            aria-expanded={completo}
            onClick={() => setCompleto((v) => !v)}
            className="min-h-9 cursor-pointer rounded-full px-2 text-[13px] font-extrabold text-accent-700 underline underline-offset-2"
          >
            {completo ? 'Ocultar el año completo' : `Ver ${anio} completo${feriados.data ? ` (${feriados.data.filter((f) => !f.quitado).length})` : ''}`}
          </button>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        {completo && (
          <div className="flex flex-col gap-3 border-t border-divider pt-3">
            <Pestanas
              etiqueta="Año"
              tono="team"
              valor={String(anio)}
              onChange={(v) => setAnio(Number(v))}
              pestanas={[actual, actual + 1].map((a) => ({ valor: String(a), etiqueta: String(a) }))}
              panelId="feriados-anio"
            />
            <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Un feriado quitado cuenta como día hábil.</p>
            <div id="feriados-anio" role="tabpanel" className="overflow-x-auto">
              <EstadoConsulta consulta={feriados} vacio={(f) => f.length === 0} textoVacio="No hay feriados registrados para este año">
                {(lista) => (
                  <Tabla etiqueta={`Feriados de ${anio}`}>
                    <thead>
                      <tr>
                        <Th>Fecha</Th>
                        <Th>Feriado</Th>
                        <Th>Origen</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((f) => (
                        <tr key={f.fecha}>
                          <Td className={`whitespace-nowrap tabular-nums ${f.quitado ? 'line-through' : ''}`}>{formatoFecha(f.fecha)}</Td>
                          <Td className={f.quitado ? 'line-through' : ''}>{f.nombre}</Td>
                          <Td>
                            {f.quitado ? (
                              <Badge tono="neutro">Quitado</Badge>
                            ) : (
                              <Badge tono={f.origen === 'LEY' ? 'neutro' : 'atencion'}>{f.origen === 'LEY' ? 'Ley' : 'Centro'}</Badge>
                            )}
                          </Td>
                          <Td>
                            {f.fecha >= hoy &&
                              (f.quitado ? (
                                <Button
                                  variant="ghost"
                                  loading={agregar.isPending && agregar.variables?.fecha === f.fecha}
                                  onClick={() => agregar.mutate({ fecha: f.fecha, nombre: f.nombre })}
                                >
                                  Reponer
                                </Button>
                              ) : (
                                <Button variant="ghost" loading={quitar.isPending && quitar.variables === f.fecha} onClick={() => quitar.mutate(f.fecha)}>
                                  Quitar
                                </Button>
                              ))}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                )}
              </EstadoConsulta>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
