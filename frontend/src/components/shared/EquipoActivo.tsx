'use client';

import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';

import { Field, Select } from '@/components/ui/Field';
import { useProfesionales } from '@/lib/consultas';

/**
 * Contexto de equipo del backoffice (ADMIN/GESTION): "todo el equipo" o un
 * profesional. Solo filtra lo que se muestra (agenda, pacientes); no cambia
 * permisos ni el token. Vive en memoria y se reinicia al cambiar de rol.
 */
interface EquipoActivoValor {
  profesionalId: string | null;
  setProfesionalId: (id: string | null) => void;
}

const Contexto = createContext<EquipoActivoValor>({ profesionalId: null, setProfesionalId: () => {} });

export function ProveedorEquipoActivo({ children }: { children: ReactNode }) {
  const [profesionalId, setProfesionalId] = useState<string | null>(null);
  return <Contexto.Provider value={{ profesionalId, setProfesionalId }}>{children}</Contexto.Provider>;
}

export const useEquipoActivo = () => useContext(Contexto);

export function SelectorEquipo() {
  const { profesionalId, setProfesionalId } = useEquipoActivo();
  const profesionales = useProfesionales(true);
  return (
    <Field label="Equipo" error={profesionales.error ? 'No pudimos cargar el equipo.' : undefined}>
      {(p) => (
        <Select
          {...p}
          value={profesionalId ?? ''}
          disabled={profesionales.isPending}
          onChange={(e) => setProfesionalId(e.target.value || null)}
          className="!py-2.5 !text-[13.5px]"
        >
          <option value="">Todo el equipo</option>
          {profesionales.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre ?? 'Sin nombre'}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * 03b-4.1: indicador visible del integrante elegido. Agenda, pendientes y
 * cobros ya se filtran por el; desde aca se abre su perfil (Equipo, solo
 * metadata: nunca datos clinicos para ADMIN/GESTION) o se vuelve a todo el
 * equipo.
 */
export function ViendoA() {
  const { profesionalId, setProfesionalId } = useEquipoActivo();
  const nombre = useProfesionales(!!profesionalId).data?.find((m) => m.id === profesionalId)?.nombre;
  if (!profesionalId) return null;
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border border-accent-500 bg-accent-200 px-4 py-2.5 text-[13.5px] font-bold text-accent-900"
    >
      <Icon name="person_search" size={19} />
      <span className="min-w-0 flex-1">
        Viendo a <span className="font-black">{nombre ?? 'un integrante'}</span>: agenda, pendientes y cobros muestran solo lo suyo.
      </span>
      <Link href={`/admin/equipo?id=${profesionalId}`} className="font-extrabold text-accent-900 underline underline-offset-2">
        Ver su perfil
      </Link>
      <button
        type="button"
        onClick={() => setProfesionalId(null)}
        className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-accent-700 px-3.5 font-extrabold text-accent-900 hover:bg-accent-300"
      >
        <Icon name="arrow_back" size={16} />
        Volver a todo el equipo
      </button>
    </div>
  );
}
