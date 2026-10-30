'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
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

  return (
    <div className="flex flex-col gap-6">
      <Panel titulo="Feriados" bajada="Días que no cuentan en los plazos de días hábiles, como las solicitudes de datos.">
        <Aviso tono="nota" titulo="Los feriados nacionales se calculan solos">
          El sistema aplica las reglas de la ley cada año (Semana Santa, traslados al lunes, solsticio, Fiestas Patrias). Agrega aquí los que no siguen una
          regla, como un feriado regional o uno que fije una ley especial.
        </Aviso>
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
          <Field label="Fecha" required>
            {(p) => <Input {...p} type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />}
          </Field>
          <Field label="Nombre" required hint="Por ejemplo: Feriado regional de Arica.">
            {(p) => <Input {...p} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="team" icon="event_busy" loading={agregar.isPending} onClick={enviar}>
            Agregar feriado
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 mt-2 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </Panel>

      <Panel titulo={`Feriados de ${anio}`} bajada="Un feriado quitado cuenta como día hábil.">
        <div className="mt-4 flex flex-col gap-4">
          <Pestanas
            etiqueta="Año"
            tono="team"
            valor={String(anio)}
            onChange={(v) => setAnio(Number(v))}
            pestanas={[actual, actual + 1].map((a) => ({ valor: String(a), etiqueta: String(a) }))}
            panelId="feriados-anio"
          />
          <div id="feriados-anio" role="tabpanel">
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
      </Panel>
    </div>
  );
}
