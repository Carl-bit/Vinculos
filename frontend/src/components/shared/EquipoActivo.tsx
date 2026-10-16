'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

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
