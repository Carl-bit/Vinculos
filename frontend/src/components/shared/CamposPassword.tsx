'use client';

import { useState } from 'react';

import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';

export const MINIMO_PASSWORD = 10;

/** Valida contraseña nueva + repeticion (la API exige 10 a 200 caracteres). */
export function errorPassword(nueva: string, repetida: string): { nueva?: string; repetida?: string } {
  if (nueva.length < MINIMO_PASSWORD) return { nueva: `Usa al menos ${MINIMO_PASSWORD} caracteres.` };
  if (nueva.length > 200) return { nueva: 'Usa como máximo 200 caracteres.' };
  if (nueva !== repetida) return { repetida: 'Las contraseñas no coinciden.' };
  return {};
}

/** Contraseña nueva y su repeticion, con ver/ocultar y la regla visible. */
export function CamposPassword({
  nueva,
  repetida,
  onNueva,
  onRepetida,
  errores = {},
  etiqueta = 'Contraseña nueva',
}: {
  nueva: string;
  repetida: string;
  onNueva: (v: string) => void;
  onRepetida: (v: string) => void;
  errores?: { nueva?: string; repetida?: string };
  etiqueta?: string;
}) {
  const [ver, setVer] = useState(false);
  return (
    <>
      <Field
        label={etiqueta}
        error={errores.nueva}
        hint={`Al menos ${MINIMO_PASSWORD} caracteres. Una frase corta es fácil de recordar y difícil de adivinar.`}
      >
        {(p) => (
          <span className="relative block">
            <Input
              {...p}
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => onNueva(e.target.value)}
              className="pr-14"
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'}
              className="absolute top-1/2 right-[9px] grid -translate-y-1/2 cursor-pointer place-items-center rounded-full p-2 text-neutral-700 hover:bg-accent-200 hover:text-accent-700"
            >
              <Icon name={ver ? 'visibility_off' : 'visibility'} size={20} />
            </button>
          </span>
        )}
      </Field>
      <Field label="Repite la contraseña" error={errores.repetida}>
        {(p) => <Input {...p} type={ver ? 'text' : 'password'} autoComplete="new-password" value={repetida} onChange={(e) => onRepetida(e.target.value)} />}
      </Field>
    </>
  );
}
