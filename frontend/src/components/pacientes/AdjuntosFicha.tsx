'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ApiError } from '@/lib/api/errores';
import { descargarArchivo } from '@/lib/descargas';
import { useAdjuntos, type AdjuntoFicha } from '@/lib/fichas';
import { formatoFechaHora } from '@/lib/formato';
import { subirArchivo } from '@/lib/subidas';

const tamano = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Adjuntos externos (informes o imagenes de terceros) que sube el tratante.
 * Solo PDF, PNG o JPEG: la API valida el tipo por el contenido (422) y el
 * tamaño (413). Se guardan cifrados; cada subida y descarga queda auditada.
 */
export function AdjuntosFicha({ pacienteId }: { pacienteId: string }) {
  const adjuntos = useAdjuntos(pacienteId);
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const subir = useMutation({
    mutationFn: (archivo: File) => subirArchivo<AdjuntoFicha>(`/api/pacientes/${pacienteId}/adjuntos`, 'archivo', archivo),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['ficha', 'adjuntos', pacienteId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos subir el archivo.'),
  });
  const elegir = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setError(undefined);
    subir.mutate(archivo);
  };
  const descargar = async (a: AdjuntoFicha) => {
    setError(undefined);
    const r = await descargarArchivo(`/api/adjuntos-ficha/${a.id}`, a.nombreArchivo);
    if (r !== 'listo') setError('No pudimos descargar el archivo. Intenta de nuevo.');
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[560px] text-[13.5px] font-semibold text-neutral-800">
          Informes o exámenes de otros profesionales. PDF, PNG o JPEG. Los ve solo el equipo tratante.
        </p>
        <input ref={entrada} type="file" accept="application/pdf,image/png,image/jpeg" onChange={elegir} className="sr-only" tabIndex={-1} aria-hidden="true" />
        <Button variant="team" icon="upload" loading={subir.isPending} onClick={() => entrada.current?.click()}>
          Subir archivo
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <EstadoConsulta consulta={adjuntos} vacio={(l) => l.length === 0} textoVacio="Sin adjuntos">
        {(lista) => (
          <ul className="m-0 flex list-none flex-col p-0">
            {lista.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                <div className="flex min-w-0 items-center gap-3">
                  <Icon name={a.tipoMime === 'application/pdf' ? 'picture_as_pdf' : 'image'} size={22} className="flex-none text-accent-700" />
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[14px] font-extrabold">{a.nombreArchivo}</p>
                    <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                      {tamano(a.tamanoBytes)} · subido el {formatoFechaHora(a.subidoEn)}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" icon="download" onClick={() => void descargar(a)} className="!px-3.5 !py-2 !text-[13px]">
                  Descargar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
    </div>
  );
}
