'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Punto 10: el sitio publico se arma en el servidor (cache de 60 s). Con la
 * pestaña visible, cada 60 s se pide de nuevo: una pausa o baja de un
 * profesional deja de ofrecer sus botones sin recargar a mano. router.refresh
 * conserva el estado de los formularios del cliente.
 */
export function RefrescoPublico() {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
