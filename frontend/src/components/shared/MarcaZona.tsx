import { cssMarca, type Zona } from '@/lib/marca';

/**
 * Colores del centro para una zona (03c): reemplaza los tokens del tema con un
 * <style> (sirve en SSR y cubre los modales montados en <body>). Sin colores
 * propios no rinde nada y quedan los del sistema.
 */
export function MarcaZona({ zona, principal, fondo }: { zona: Zona; principal?: string | null; fondo?: string | null }) {
  const css = cssMarca(zona, principal, fondo);
  return css ? <style data-marca={zona}>{css}</style> : null;
}
