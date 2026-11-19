'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { Field, Select } from '@/components/ui/Field';
import { useProfesionales } from '@/lib/consultas';

/**
 * Contexto de equipo del backoffice (ADMIN/GESTION): "todo el equipo" o un
 * profesional. Solo filtra lo que se muestra (agenda, pacientes); no cambia
 * permisos ni el token. Vive en memoria y se reinicia al cambiar de rol.
 * 03b-4.1: tambien va en la URL (?equipo=<id>, sin datos clinicos), asi
 * sobrevive a recargar la pagina y el enlace se puede compartir.
 */
interface EquipoActivoValor {
  profesionalId: string | null;
  setProfesionalId: (id: string | null) => void;
}

const Contexto = createContext<EquipoActivoValor>({ profesionalId: null, setProfesionalId: () => {} });

const PARAMETRO = 'equipo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Integrante en la URL al cargar (solo un id con formato valido; la API decide si existe). */
const desdeUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get(PARAMETRO);
  return id && UUID.test(id) ? id : null;
};

export function ProveedorEquipoActivo({ habilitado, children }: { habilitado: boolean; children: ReactNode }) {
  const [profesionalId, setEstado] = useState<string | null>(() => (habilitado ? desdeUrl() : null));
  const ruta = usePathname();
  const parametros = useSearchParams();
  /** Elegir (o volver a todo el equipo) escribe la URL en el momento. */
  const setProfesionalId = useCallback((id: string | null) => {
    setEstado(id);
    escribirUrl(id);
  }, []);
  useEffect(() => {
    if (!habilitado) return;
    const enUrl = parametros.get(PARAMETRO);
    // Correcciones 2026-11-11 (punto 11): el integrante elegido vive solo en la URL de la vista que lo
    // filtra (agenda). Al cambiar de seccion (menu, sin ?equipo=) se vuelve a la vista de la cuenta madre.
    setEstado(enUrl && UUID.test(enUrl) ? enUrl : null);
  }, [habilitado, ruta, parametros]);
  return <Contexto.Provider value={{ profesionalId, setProfesionalId }}>{children}</Contexto.Provider>;
}

/** null como estado del historial: asi el router de Next sincroniza useSearchParams. */
function escribirUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PARAMETRO, id);
  else url.searchParams.delete(PARAMETRO);
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

export const useEquipoActivo = () => useContext(Contexto);

export function SelectorEquipo() {
  const { profesionalId, setProfesionalId } = useEquipoActivo();
  const profesionales = useProfesionales(true);
  return (
    <Field label="Equipo" error={profesionales.error ? 'No pudimos cargar el equipo.' : undefined}>
      {(p) => (
        <Select buscable
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
