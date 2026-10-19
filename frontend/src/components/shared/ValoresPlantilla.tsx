import { formatoFecha } from '@/lib/formato';

import type { CampoPlantilla, ValoresPlantilla as Valores } from './FormularioDinamico';

/** Texto de un valor segun el tipo del campo (la version con que se escribio el registro). */
function textoValor(c: CampoPlantilla, v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (c.tipo === 'SI_NO') return v ? 'Sí' : 'No';
  if (c.tipo === 'FECHA' && typeof v === 'string') return formatoFecha(v);
  return String(v);
}

/**
 * Valores de un registro clinico (ingreso, evolucion) leidos con la
 * definicion de SU version de plantilla, nunca con la vigente: un campo que
 * ya no existe en la version nueva se sigue mostrando con su etiqueta.
 */
export function ValoresPlantilla({
  campos,
  valores,
  vacio = 'Sin datos en los campos de la plantilla.',
}: {
  campos: readonly CampoPlantilla[];
  valores: Valores | null;
  vacio?: string;
}) {
  const llenos = [...campos].sort((a, b) => a.orden - b.orden).filter((c) => valores && valores[c.clave] !== undefined && valores[c.clave] !== '');
  if (!llenos.length) return <p className="m-0 text-[13px] font-semibold text-neutral-700">{vacio}</p>;
  return (
    <dl className="m-0 grid gap-3">
      {llenos.map((c) => (
        <div key={c.clave}>
          <dt className="text-xs font-extrabold text-neutral-700">{c.etiqueta}</dt>
          <dd className="m-0 text-[14.5px] font-semibold whitespace-pre-line text-pretty">{textoValor(c, valores![c.clave])}</dd>
        </div>
      ))}
    </dl>
  );
}
