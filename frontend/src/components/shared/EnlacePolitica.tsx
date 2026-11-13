'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';

type TipoAceptable = 'POLITICA_DATOS' | 'TERMINOS_AGENDAMIENTO';
export type PoliticaVigente = { id: string; version: number };

const TITULOS: Record<TipoAceptable, string> = {
  POLITICA_DATOS: 'Política de datos personales',
  TERMINOS_AGENDAMIENTO: 'Términos de agendamiento y cancelación',
};

/** Misma clave que el resto de las vistas: invalidarla trae la version vigente. */
export const clavePolitica = (tipo: TipoAceptable) => ['publico', 'politica', tipo] as const;

const leerVigente = (tipo: TipoAceptable) => datos(api.GET('/api/publico/politicas/{tipo}', { params: { path: { tipo } } }));

/** Version vigente pedida de nuevo a la API (sin cache). */
export const vigentePolitica = (cliente: QueryClient, tipo: TipoAceptable) =>
  cliente.fetchQuery({ queryKey: clavePolitica(tipo), queryFn: () => leerVigente(tipo), staleTime: 0 }).catch(() => null);

/** 422 de la BD (aceptaciones_politica_version_vigente): se acepto una version ya reemplazada. */
export const esVersionNueva = (e: unknown) => e instanceof ApiError && e.status === 422 && /versi[oó]n nueva de la pol[ií]tica/i.test(e.message);

export const MENSAJE_VERSION_NUEVA =
  'El centro publicó una versión nueva de sus documentos mientras completabas la reserva. Ábrela, léela y vuelve a aceptarla para reservar.';

/**
 * Enlace a una politica dentro de la casilla de aceptacion: abre el texto
 * vigente en un modal (sin salir del formulario) y lo vuelve a pedir a la API
 * al abrir. Si la version cambio, avisa con `onVersion` para que el
 * formulario envie el id nuevo (la BD rechaza aceptar una version vieja).
 * "Leí y acepto" marca la casilla desde el modal.
 */
export function EnlacePolitica({
  tipo,
  children,
  onVersion,
  onAceptar,
}: {
  tipo: TipoAceptable;
  children: ReactNode;
  onVersion?: (p: PoliticaVigente) => void;
  onAceptar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const politica = useQuery({
    queryKey: clavePolitica(tipo),
    queryFn: () => leerVigente(tipo),
    enabled: abierto,
    staleTime: 0,
  });
  const p = politica.data;
  useEffect(() => {
    if (p) onVersion?.({ id: p.id, version: p.version });
  }, [p, onVersion]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Dentro de un <label>: que abrir el texto no marque la casilla.
          e.preventDefault();
          setAbierto(true);
          void politica.refetch();
        }}
        className="cursor-pointer font-extrabold text-accent-2-700 underline underline-offset-2 hover:text-accent-2-800"
      >
        {children}
      </button>
      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        ancho="lg"
        titulo={TITULOS[tipo]}
        descripcion={p ? `Versión ${p.version}, vigente desde el ${formatoFechaLarga(p.vigente_desde)}.` : undefined}
        acciones={
          <>
            <Button variant="ghost" onClick={() => setAbierto(false)}>
              Cerrar
            </Button>
            <Button
              disabled={!p}
              onClick={() => {
                onAceptar();
                setAbierto(false);
              }}
            >
              Leí y acepto
            </Button>
          </>
        }
      >
        {p ? (
          <div className="max-h-[55vh] overflow-y-auto rounded-tarjeta border border-borde bg-papel px-5 py-4 text-[15px] leading-[1.7] text-pretty whitespace-pre-line text-neutral-800">
            {p.texto}
          </div>
        ) : politica.isError ? (
          <p role="alert" className="m-0 text-sm font-bold text-accent-700">
            No pudimos cargar el documento. Cierra y vuelve a intentar.
          </p>
        ) : (
          <div aria-busy="true" className="esqueleto h-40 rounded-tarjeta" />
        )}
      </Modal>
    </>
  );
}
