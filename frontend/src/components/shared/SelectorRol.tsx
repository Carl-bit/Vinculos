'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Field, Select } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/errores';
import { inicioDeRol, NOMBRE_ROL } from '@/lib/roles';
import { cambiarRol, type Rol } from '@/lib/sesion';

/**
 * Rol activo, siempre visible. Con varios roles permite cambiarlo: token
 * nuevo, cache vaciada (permisos recargados) y vuelta al inicio del rol.
 */
export function SelectorRol({ rol, roles }: { rol: Rol; roles: readonly Rol[] }) {
  const router = useRouter();
  const cliente = useQueryClient();
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<string>();

  if (roles.length < 2) {
    return (
      <p className="m-0 px-2 text-[11.5px] font-semibold text-neutral-700">
        Rol activo: <span className="font-extrabold text-text">{NOMBRE_ROL[rol]}</span>
      </p>
    );
  }

  const cambiar = async (nuevo: Rol) => {
    setCambiando(true);
    setError(undefined);
    try {
      await cambiarRol(nuevo);
      cliente.clear();
      router.replace(inicioDeRol(nuevo));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cambiar el rol.');
    } finally {
      setCambiando(false);
    }
  };

  return (
    <Field label="Rol activo" error={error}>
      {(p) => (
        <Select {...p} value={rol} disabled={cambiando} onChange={(e) => void cambiar(e.target.value as Rol)} className="!py-2.5 !text-[13.5px]">
          {roles.map((r) => (
            <option key={r} value={r}>
              {NOMBRE_ROL[r]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
