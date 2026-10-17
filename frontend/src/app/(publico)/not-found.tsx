import Link from 'next/link';

import { EstadoVista } from '@/components/shared/EstadoVista';

export default function NoEncontrado() {
  return (
    <EstadoVista
      estado="vacio"
      titulo="No encontramos esta página"
      mensaje={
        <>
          Puede que el perfil ya no esté publicado. <Link href="/equipo">Ver el equipo</Link>
        </>
      }
    />
  );
}
