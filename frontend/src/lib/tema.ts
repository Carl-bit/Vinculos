/**
 * Estilo visual del silo. Los tokens de cada tema cuelgan de :root[data-tema]
 * (app/temas/); los componentes solo lo consultan cuando el tema cambia el
 * marcado, no solo el color (tapas del Cuaderno).
 *
 * R11 (2026-11-13): se lee en runtime (TEMA del .env del silo), no al
 * compilar: la misma imagen vinculos-web sirve a todos los centros. Solo en el
 * servidor (componentes de servidor). Pasara a configuracion_centro cuando
 * Vinculos Control aplique el manifiesto (R4).
 */
import { connection } from 'next/server';
import { cache } from 'react';

export type Tema = 'moderno' | 'cuaderno';

/** Tema del silo. `connection()`: render por request, el valor no queda horneado en el build. */
export const temaDelSilo = cache(async (): Promise<Tema> => {
  await connection();
  // NEXT_PUBLIC_TEMA queda solo como respaldo de desarrollo (npm run dev).
  const valor = process.env.TEMA ?? process.env.NEXT_PUBLIC_TEMA;
  return valor === 'cuaderno' ? 'cuaderno' : 'moderno';
});

export const esCuaderno = cache(async (): Promise<boolean> => (await temaDelSilo()) === 'cuaderno');
