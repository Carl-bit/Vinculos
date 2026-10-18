'use client';

import { Suspense } from 'react';

import { ConfiguracionCentro } from '@/components/nucleo/ConfiguracionCentro';
import { EstadoVista } from '@/components/shared/EstadoVista';
import { useSesion } from '@/lib/consultas';

/** Configuracion del centro: solo la cuenta madre (ADMIN). */
function Configuracion() {
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  if (sesion.sesion.rol !== 'ADMIN') return <EstadoVista estado="sin-permiso" />;
  return <ConfiguracionCentro />;
}

export default function Pagina() {
  return (
    <Suspense>
      <Configuracion />
    </Suspense>
  );
}
