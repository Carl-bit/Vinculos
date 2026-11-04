'use client';

import type { DatoMensaje } from '@/lib/variablesMensaje';

/** Datos que se pueden insertar en un mensaje o documento: al pulsar, se agrega al texto. */
export function DatosDisponibles({ datos, onElegir }: { datos: readonly DatoMensaje[]; onElegir: (texto: string) => void }) {
  return (
    <div>
      <p className="m-0 mb-1.5 text-[12.5px] font-bold text-neutral-800">Pulsa un dato para agregarlo al final del texto:</p>
      <div className="flex flex-wrap gap-1.5">
        {datos.map((d) => (
          <button
            key={d.simple}
            type="button"
            onClick={() => onElegir(`{${d.simple}}`)}
            className="min-h-8 cursor-pointer rounded-full border border-divider bg-neutral-100 px-3 text-[12.5px] font-bold hover:border-accent-500 hover:bg-accent-200"
          >
            {`{${d.simple}}`} <span className="font-semibold text-neutral-700">{d.descripcion}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
