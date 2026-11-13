'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { cerrarSesion } from '@/lib/sesion';

import { CamposPassword, errorPassword } from './CamposPassword';

/** Cambiar la contraseña con la actual (portal y "Mi perfil" del backoffice). */
export function CambioPassword({ tono = 'patient', enPanel = true }: { tono?: 'patient' | 'team'; enPanel?: boolean }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string; repetida?: string }>({});
  const cambiar = useMutation({
    mutationFn: () => datos(api.POST('/api/usuarios/yo/password', { body: { actual, nueva } })),
    // La BD cierra todas las sesiones al cambiar la contraseña (tambien esta): se vuelve a ingresar con la nueva.
    onSuccess: () => void cerrarSesion('clave-cambiada'),
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 422)) setErrores({ actual: 'La contraseña actual no es correcta.' });
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const err = { ...(actual ? {} : { actual: 'Escribe tu contraseña actual.' }), ...errorPassword(nueva, repetida) };
    setErrores(err);
    if (err.actual || err.nueva || err.repetida) return;
    cambiar.mutate();
  };

  const formulario = (
    <form onSubmit={enviar} className="flex max-w-[460px] flex-col gap-4" noValidate>
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
