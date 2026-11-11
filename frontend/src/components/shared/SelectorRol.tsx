'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError } from '@/lib/api/errores';
import { inicioDeRol, NOMBRE_ROL } from '@/lib/roles';
import { cambiarRolConCarga } from '@/lib/cambioRol';
import type { Rol } from '@/lib/sesion';

/**
 * Rol activo, siempre visible. Con varios roles, un boton por rol (punto 12,
 * 2026-11-11): token nuevo, cache vaciada (permisos recargados) y vuelta al
 * inicio del rol. Mientras cambia, los botones quedan bloqueados.
 */
export function SelectorRol({ rol, roles }: { rol: Rol; roles: readonly Rol[] }) {
  const router = useRouter();
  const cliente = useQueryClient();
  const [cambiando, setCambiando] = useState<Rol | null>(null);
  const [error, setError] = useState<string>();

  if (roles.length < 2) {
    return (
      <p className="m-0 px-2 text-[12px] font-semibold text-neutral-700">
        Rol activo: <span className="font-extrabold text-text">{NOMBRE_ROL[rol]}</span>
      </p>
    );
  }

  const cambiar = async (nuevo: Rol) => {
    setCambiando(nuevo);
    setError(undefined);
    try {
      await cambiarRolConCarga(nuevo);
      cliente.clear();
      router.replace(inicioDeRol(nuevo));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cambiar el rol.');
    } finally {
      setCambiando(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-2">
      <span id="rol-activo" className="text-[12px] font-extrabold text-neutral-700">
        Rol activo
      </span>
      <div role="group" aria-labelledby="rol-activo" className="flex flex-wrap gap-1 rounded-full bg-neutral-200 p-1">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === rol}
            disabled={cambiando !== null}
            onClick={() => r !== rol && void cambiar(r)}
            className={`min-h-9 flex-1 cursor-pointer rounded-full px-3 text-[12.5px] font-extrabold transition-colors duration-200 disabled:cursor-wait ${
              r === rol ? 'bg-accent-700 text-neutral-100' : 'text-text hover:bg-neutral-300'
            }`}
          >
            {cambiando === r ? 'Cambiando…' : NOMBRE_ROL[r]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </div>
  );
}
