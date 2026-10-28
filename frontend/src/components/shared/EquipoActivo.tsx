'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';

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
    if (enUrl && UUID.test(enUrl)) {
      // Un enlace con ?equipo=<id> (por ejemplo "Ver mi agenda" de un perfil) elige a ese integrante.
      setEstado(enUrl);
    } else if (profesionalId) {
      // Una vista sin el parametro (menu, ?vista= de una pagina) conserva el integrante elegido.
      escribirUrl(profesionalId);
    }
    // profesionalId fuera a proposito: solo reacciona a la navegacion; el setter ya escribe la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
