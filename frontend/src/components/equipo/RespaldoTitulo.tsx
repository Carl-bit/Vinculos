'use client';

import { useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { components } from '@/lib/api/esquema';
import { descargarArchivo } from '@/lib/descargas';
import { formatoFecha } from '@/lib/formato';

import { VisorArchivo } from './VisorArchivo';

type Trayectoria = components['schemas']['TrayectoriaVista'];

/**
 * Respaldo de un titulo (2026-11-07): el archivo mas reciente, para verlo en
 * pantalla o descargarlo (el propio y ADMIN/GESTION; ambos quedan en el
 * registro de descargas) y cuantas versiones anteriores hay. Sin archivo, lo
 * dice: verificar lo exige. 2026-11-08: la observacion de la cuenta madre se
 * muestra hasta que se suba una version nueva o se verifique.
 * `pieVisor`: acciones dentro del visor (la cuenta madre observa desde ahi).
 */
export function RespaldoTitulo({ t, pieVisor }: { t: Trayectoria; pieVisor?: ReactNode }) {
  const [error, setError] = useState(false);
  const [viendo, setViendo] = useState(false);
  const [ultimo, ...anteriores] = t.respaldos;
  const observacion = t.observacion && (
    <p className="m-0 flex items-start gap-2 rounded-[12px] border border-accent-500 bg-accent-100 px-3 py-2.5 text-[12.5px] leading-snug font-bold text-accent-900">
      <Icon name="edit_note" size={18} className="mt-px" />
      <span>
        Observación del centro{t.observadaEn ? ` (${formatoFecha(t.observadaEn)})` : ''}: {t.observacion}
        <span className="block font-semibold text-accent-800">Sube una versión nueva del respaldo para que lo revisen otra vez.</span>
      </span>
    </p>
  );
  if (!ultimo)
    return (
      <div className="flex flex-col gap-2">
        {observacion}
        <p className="m-0 flex items-start gap-2 rounded-[12px] bg-accent-100 px-3 py-2.5 text-[12.5px] leading-snug font-bold text-accent-800">
          <Icon name="warning" size={18} className="mt-px" />
          <span>
            {t.verificado
              ? 'Verificado antes de exigir el archivo. Sube el respaldo para que quede guardado en el centro.'
              : 'Falta el respaldo. Sin él, el centro no puede verificar el título.'}
            {t.documentoRespaldoUrl && <span className="block font-semibold text-neutral-700">Hay un enlace anterior, que ya no cuenta.</span>}
          </span>
        </p>
      </div>
    );
  const ruta = `/api/trayectoria/respaldos/${ultimo.id}`;
  const descargar = async () => setError((await descargarArchivo(ruta, ultimo.nombreArchivo)) !== 'listo');
  return (
    <div className="flex flex-col gap-2">
      {observacion}
      <div className="flex items-center gap-2.5 rounded-[12px] border border-divider bg-neutral-100 px-3 py-2.5">
        <Icon name={ultimo.tipoMime === 'application/pdf' ? 'picture_as_pdf' : 'image'} size={22} className="text-accent-800" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-text">{ultimo.nombreArchivo}</span>
          <span className="block text-[12px] font-semibold text-neutral-700">
            Subido el {formatoFecha(ultimo.subidoEn)}
            {anteriores.length > 0 && ` · ${anteriores.length} ${anteriores.length === 1 ? 'versión anterior' : 'versiones anteriores'}`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setViendo(true)}
          aria-label={`Ver respaldo ${ultimo.nombreArchivo}`}
          className="grid size-9 flex-none cursor-pointer place-items-center rounded-full text-accent-800 hover:bg-accent-200"
        >
          <Icon name="visibility" size={18} />
        </button>
        <button
          type="button"
          onClick={() => void descargar()}
          aria-label={`Descargar respaldo ${ultimo.nombreArchivo}`}
          className="grid size-9 flex-none cursor-pointer place-items-center rounded-full text-accent-800 hover:bg-accent-200"
        >
          <Icon name="download" size={18} />
        </button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          No pudimos descargarlo.
        </p>
      )}
      <VisorArchivo abierto={viendo} onCerrar={() => setViendo(false)} ruta={ruta} nombre={ultimo.nombreArchivo} tipoMime={ultimo.tipoMime} pie={pieVisor} />
    </div>
  );
}
