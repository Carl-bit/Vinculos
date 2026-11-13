'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Interruptor } from '@/components/ui/Interruptor';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';

type Preferencias = components['schemas']['PreferenciasEquipo'];

const CLAVE = ['panel', 'preferencias-equipo'];
const GRUPOS: { k: keyof Preferencias; etiqueta: string; nota: string }[] = [
  { k: 'agenda', etiqueta: 'Agenda', nota: 'Citas canceladas y horas pedidas.' },
  { k: 'cobros', etiqueta: 'Cobros', nota: 'Sesiones con pago pendiente.' },
  { k: 'derivaciones', etiqueta: 'Derivaciones', nota: 'Cambios en una derivación que iniciaste.' },
  { k: 'mensajes', etiqueta: 'Mensajes', nota: 'Mensajes de pacientes y del equipo.' },
];

/**
 * Avisos por correo del propio integrante (diseño "Admin - Mi Perfil"). Se
 * guarda al cambiar. Solo afecta el correo: la bandeja registra todo, y lo que
 * tiene plazo o es legal llega siempre (grupo_aviso_equipo() en la BD).
 */
export function AvisosEquipo() {
  const cliente = useQueryClient();
  const preferencias = useQuery({ queryKey: CLAVE, queryFn: () => datos(api.GET('/api/notificaciones/preferencias-equipo')) });
  const [error, setError] = useState<string>();
  const guardar = useMutation({
    mutationFn: (body: Partial<Preferencias>) => datos(api.PUT('/api/notificaciones/preferencias-equipo', { body })),
    onSuccess: (p) => {
      setError(undefined);
      cliente.setQueryData(CLAVE, p);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar tu preferencia.'),
  });
  return (
    <EstadoConsulta consulta={preferencias}>
      {(p) => (
        <div className="flex flex-col gap-3 pt-2">
          {GRUPOS.map((g) => (
            <Interruptor
              key={g.k}
              tono="team"
              etiqueta={g.etiqueta}
              descripcion={g.nota}
              activo={p[g.k]}
              deshabilitado={guardar.isPending}
              onChange={(v) => guardar.mutate({ [g.k]: v })}
            />
          ))}
          <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
            Las ofertas de derivación, los cierres de sesión pendientes y los avisos legales llegan siempre. Todo queda en tu{' '}
            <Link href="/admin/mensajes?vista=avisos" className="font-extrabold text-accent-700">
              bandeja de avisos
            </Link>
            .
          </p>
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
        </div>
      )}
    </EstadoConsulta>
  );
}
