/**
 * Parametros tributarios para calculos informativos (no tributarios): la
 * retencion de la boleta de honorarios sube por año (Ley 21.133) y el IVA del
 * arriendo de box amoblado. Los mantiene Vinculos con la ley vigente; la API
 * no los entrega porque no participan en ningun calculo con efecto.
 */
export const RETENCION_HONORARIOS: readonly { anio: number; porcentaje: number }[] = [
  { anio: 2026, porcentaje: 15.25 },
  { anio: 2027, porcentaje: 16 },
  { anio: 2028, porcentaje: 17 },
];
export const IVA_PORCENTAJE = 19;

/** Retencion vigente un año (la ultima conocida si el año es posterior). */
export function retencionDelAnio(anio: number): number {
  const conocidas = RETENCION_HONORARIOS.filter((r) => r.anio <= anio);
  return (conocidas.at(-1) ?? RETENCION_HONORARIOS[0]!).porcentaje;
}
