'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/api/errores';
import { descargarArchivo, obtenerArchivo } from '@/lib/descargas';

/**
 * Documento en pantalla (2026-11-08): PDF en un visor del navegador o la
 * imagen. Se pide con la sesion (queda en el registro de descargas igual que
 * bajarlo) y el object URL se libera al cerrar; nunca se guarda.
 */
export function VisorArchivo({
  abierto,
  onCerrar,
  ruta,
  nombre,
  tipoMime,
  pie,
}: {
  abierto: boolean;
  onCerrar: () => void;
  ruta: string;
  nombre: string;
  tipoMime: string;
  /** Acciones bajo el documento (p. ej. observar). */
  pie?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    let creado: string | null = null;
    obtenerArchivo(ruta)
      .then((b) => {
        creado = URL.createObjectURL(b);
        if (vivo) setUrl(creado);
      })
      .catch((e: unknown) => vivo && setError(e instanceof ApiError ? e.message : 'No pudimos abrir el documento.'));
    return () => {
      vivo = false;
      if (creado) URL.revokeObjectURL(creado);
      setUrl(null);
      setError(undefined);
    };
  }, [abierto, ruta]);
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={nombre}
      ancho="xl"
      acciones={
        <>
          <Button variant="ghost" icon="download" onClick={() => void descargarArchivo(ruta, nombre)}>
            Descargar
          </Button>
          <Button variant="team" onClick={onCerrar}>
            Listo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <p role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
            {error}
          </p>
        ) : !url ? (
          <p className="m-0 text-[13.5px] font-semibold text-neutral-700">Abriendo el documento…</p>
        ) : tipoMime === 'application/pdf' ? (
          <iframe src={url} title={nombre} className="h-[65vh] w-full rounded-[14px] border border-divider bg-neutral-100" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- object URL local del documento
          <img src={url} alt={nombre} className="max-h-[65vh] w-full rounded-[14px] border border-divider object-contain" />
        )}
        {pie}
      </div>
    </Modal>
  );
}
