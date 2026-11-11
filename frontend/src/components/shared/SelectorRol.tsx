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
 * Correcciones 2026-11-11 (punto 5): el boton no cambia su texto al cargar (un
 * texto distinto quebraba la fila a vertical); columnas fijas (un nombre largo
 * pasa a dos lineas dentro de su boton) y la carga se marca con
 * aria-busy y un pulso suave (sin animacion con prefers-reduced-motion).
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
      <div role="group" aria-labelledby="rol-activo" className="grid auto-cols-fr grid-flow-col gap-1 rounded-[22px] bg-neutral-200 p-1">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === rol}
            aria-busy={cambiando === r}
            title={NOMBRE_ROL[r]}
            disabled={cambiando !== null}
            onClick={() => r !== rol && void cambiar(r)}
            className={`min-h-9 min-w-0 cursor-pointer rounded-[18px] px-2 py-1 text-[12.5px] leading-tight font-extrabold transition-colors duration-200 disabled:cursor-wait ${cambiando === r ? 'motion-safe:animate-pulse' : ''} ${
              r === rol ? 'bg-accent-700 text-neutral-100' : 'text-text hover:bg-neutral-300'
            }`}
          >
            {NOMBRE_ROL[r]}
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
