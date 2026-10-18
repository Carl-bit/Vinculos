'use client';

import { ConfiguracionMatch } from '@/components/match/ConfiguracionMatch';
import { EstadoVista } from '@/components/shared/EstadoVista';
import { useSesion } from '@/lib/consultas';

/** Match Terapeutico: configuracion del cuestionario y metricas (solo ADMIN). */
export default function Pagina() {
  const sesion = useSesion();
  if (sesion.tipo !== 'activa') return null;
  if (sesion.sesion.rol !== 'ADMIN') return <EstadoVista estado="sin-permiso" />;
  return <ConfiguracionMatch />;
}
