'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

import { CamposPassword, errorPassword } from './CamposPassword';

/** Cambiar la contraseña con la actual (portal y "Mi perfil" del backoffice). */
export function CambioPassword({ tono = 'patient', enPanel = true }: { tono?: 'patient' | 'team'; enPanel?: boolean }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string; repetida?: string }>({});
  const [listo, setListo] = useState(false);
  const cambiar = useMutation({
    mutationFn: () => datos(api.POST('/api/usuarios/yo/password', { body: { actual, nueva } })),
    onSuccess: () => {
      setActual('');
      setNueva('');
      setRepetida('');
      setListo(true);
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 422)) setErrores({ actual: 'La contraseña actual no es correcta.' });
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setListo(false);
    const err = { ...(actual ? {} : { actual: 'Escribe tu contraseña actual.' }), ...errorPassword(nueva, repetida) };
    setErrores(err);
    if (err.actual || err.nueva || err.repetida) return;
    cambiar.mutate();
  };

  const formulario = (
    <form onSubmit={enviar} className="flex max-w-[460px] flex-col gap-4" noValidate>
      {listo && (
        <Aviso tono="exito" role="status">
          Listo, tu contraseña cambió. Úsala la próxima vez que ingreses.
        </Aviso>
      )}
      <Field label="Contraseña actual" error={errores.actual}>
        {(p) => <Input {...p} type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />}
      </Field>
      <CamposPassword nueva={nueva} repetida={repetida} onNueva={setNueva} onRepetida={setRepetida} errores={errores} />
      {cambiar.error && !errores.actual && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {cambiar.error instanceof ApiError ? cambiar.error.message : 'No pudimos cambiar la contraseña.'}
        </p>
      )}
      <div>
        <Button type="submit" variant={tono === 'team' ? 'team' : 'primary'} icon="lock" loading={cambiar.isPending}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  );
  return enPanel ? (
    <Panel titulo="Cambiar contraseña" bajada="Te pediremos la actual para confirmar que eres tú.">
      {formulario}
    </Panel>
  ) : (
    formulario
  );
}
