import type { Metadata } from 'next';

import { ComoTrabajamos, Contacto, EquipoDestacado, Portada, Servicios } from '@/components/nucleo/Landing';
import { EstadoVista } from '@/components/shared/EstadoVista';
import { centroPublico, perfilesPublicos } from '@/lib/api/servidor';

export async function generateMetadata(): Promise<Metadata> {
  const centro = await centroPublico();
  return {
    title: { absolute: centro?.nombre_centro ?? 'Centro' },
    description: centro?.hero_texto ?? undefined,
    openGraph: { title: centro?.hero_titulo ?? centro?.nombre_centro, description: centro?.hero_texto ?? undefined, type: 'website' },
  };
}

/** Landing del centro (diseño "Landing"): contenido editable por ADMIN. */
export default async function Inicio() {
  const [centro, perfiles] = await Promise.all([centroPublico(), perfilesPublicos()]);
  if (!centro || !centro.modulos.includes('PAGINA_PUBLICA')) {
    return <EstadoVista estado="vacio" titulo="Sitio del centro no disponible" mensaje="Si ya tienes cuenta, inicia sesión arriba a la derecha." />;
  }
  return (
    <>
      <Portada centro={centro} perfiles={perfiles} />
      <Servicios centro={centro} />
      <ComoTrabajamos centro={centro} />
      <EquipoDestacado perfiles={perfiles} />
      <Contacto centro={centro} perfiles={perfiles} />
    </>
  );
}
