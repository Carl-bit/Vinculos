/**
 * Identidad del centro en runtime (R11, 2026-11-13): la misma imagen
 * vinculos-web sirve a todos los silos; nada del centro se hornea al compilar.
 * Solo servidor (lee la API y el entorno del contenedor).
 */
import { cache } from 'react';

import { centroPublico } from '@/lib/api/servidor';
import { NOMBRE_RESPALDO } from '@/lib/marca';

/**
 * Nombre del centro: configuracion_centro.nombre_centro (fuente de verdad, via
 * /api/publico/centro); si la API no responde, CENTRO_NOMBRE del .env del silo.
 * NEXT_PUBLIC_CENTRO_NOMBRE queda solo como respaldo de desarrollo.
 */
export const nombreDelSilo = cache(async (): Promise<string> => {
  const centro = await centroPublico().catch(() => null);
  return centro?.nombre_centro ?? process.env.CENTRO_NOMBRE ?? process.env.NEXT_PUBLIC_CENTRO_NOMBRE ?? NOMBRE_RESPALDO;
});

/** URL publica del silo (https://<dominio>), para resolver Open Graph a URL absoluta. */
export function urlDelSilo(): string {
  return process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}
