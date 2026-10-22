'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

import { CodigosRespaldo } from './CodigosRespaldo';
import { EstadoConsulta } from './EstadoVista';

/**
 * Verificacion en dos pasos de la propia cuenta (03b-4.1): codigo por correo
 * en cada ingreso. Obligatoria (y siempre activa) para el equipo; opcional
 * para pacientes y adultos responsables. Activarla o pedir codigos nuevos
 * entrega 10 codigos de respaldo, que se muestran una sola vez.
 */
export function SegundoFactorCuenta({ tono = 'patient', enPanel = true }: { tono?: 'patient' | 'team'; enPanel?: boolean }) {
  const cliente = useQueryClient();
  const estado = useQuery({ queryKey: ['usuarios', 'yo', 'segundo-factor'], queryFn: () => datos(api.GET('/api/usuarios/yo/segundo-factor')) });
  const [codigos, setCodigos] = useState<string[]>();
  const [error, setError] = useState<string>();
  const alListo = (r: { codigos: string[] }) => {
    setCodigos(r.codigos.length ? r.codigos : undefined);
    void cliente.invalidateQueries({ queryKey: ['usuarios', 'yo', 'segundo-factor'] });
  };
  const alError = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el cambio.');
  const cambiar = useMutation({
    mutationFn: (activo: boolean) => datos(api.PUT('/api/usuarios/yo/segundo-factor', { body: { activo } })),
    onSuccess: alListo,
    onError: alError,
  });
  const nuevos = useMutation({ mutationFn: () => datos(api.POST('/api/usuarios/yo/segundo-factor/codigos-respaldo')), onSuccess: alListo, onError: alError });

  const contenido = (
    <EstadoConsulta consulta={estado}>
      {(e) => (
        <div className="mt-4 flex flex-col gap-4">
          {e.obligatorio ? (
            <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
              Activa siempre: en cada ingreso te enviamos un código de 6 dígitos a tu correo. Es obligatoria para el equipo del centro.
            </p>
          ) : (
            <Interruptor
              tono={tono}
              etiqueta="Pedir un código por correo al ingresar"
              descripcion="Además de tu contraseña, te enviaremos un código de 6 dígitos cada vez que entres."
              activo={e.activo}
              deshabilitado={cambiar.isPending}
              onChange={(v) => {
                setError(undefined);
                cambiar.mutate(v);
              }}
            />
          )}
          {e.activo && !codigos && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-bold text-neutral-800">
                Códigos de respaldo sin usar: <span className="tabular-nums">{e.codigosRespaldoRestantes}</span>
              </span>
              <Button variant="secondary" icon="key" loading={nuevos.isPending} onClick={() => nuevos.mutate()}>
                Generar códigos nuevos
              </Button>
            </div>
          )}
          {codigos && <CodigosRespaldo codigos={codigos} onListo={() => setCodigos(undefined)} textoListo="Ya los guardé" />}
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
        </div>
      )}
    </EstadoConsulta>
  );
  return enPanel ? (
    <Panel titulo="Verificación en dos pasos" bajada="Protege tu cuenta aunque alguien conozca tu contraseña.">
      {contenido}
    </Panel>
  ) : (
    contenido
  );
}
