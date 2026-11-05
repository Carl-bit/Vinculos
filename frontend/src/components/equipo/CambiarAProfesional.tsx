'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/errores';
import { NOMBRE_ROL } from '@/lib/roles';
import { cambiarRol, type Rol } from '@/lib/sesion';

/**
 * Cuenta madre con rol Profesional trabajando como ADMIN/GESTION: su perfil
 * profesional se ve abajo; indicadores, agenda propia, tarifas y trayectoria
 * se editan con el rol Profesional (la API los entrega por rol activo). El
 * cambio emite token nuevo, vacia la cache y se queda en Mi perfil.
 */
export function CambiarAProfesional({ rolActivo }: { rolActivo: Rol }) {
  const router = useRouter();
  const cliente = useQueryClient();
  const [error, setError] = useState<string>();
  const cambiar = useMutation({
    mutationFn: () => cambiarRol('PROFESIONAL'),
    onSuccess: () => {
      cliente.clear();
      router.replace('/admin/perfil');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos cambiar el rol.'),
  });
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[18px] border border-divider bg-bg px-4 py-3">
      <p className="m-0 min-w-0 flex-1 text-[13.5px] font-semibold text-neutral-800">
        Estás trabajando como {NOMBRE_ROL[rolActivo]}. Tu perfil público, tu agenda, tus tarifas y tu formación se editan con tu rol de profesional.
        {error && (
          <span role="alert" className="mt-1 block font-bold text-accent-700">
            {error}
          </span>
        )}
      </p>
      <Button variant="secondary" icon="swap_horiz" loading={cambiar.isPending} onClick={() => cambiar.mutate()} className="!py-2.5">
        Trabajar como Profesional
      </Button>
    </div>
  );
}
