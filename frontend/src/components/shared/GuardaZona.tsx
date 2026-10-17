'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSesion } from '@/lib/consultas';
import { inicioDeRol, zonaDeRol, type Zona } from '@/lib/roles';
import { renovarSesion, type SesionActiva } from '@/lib/sesion';
import { EstadoVista } from './EstadoVista';

/**
 * Guarda de experiencia (la seguridad la aplica la API): recupera la sesion
 * desde la cookie, manda al login si no hay y a la zona correcta si el rol
 * activo no corresponde.
 */
export function GuardaZona({ zona, children }: { zona: Zona; children: (sesion: SesionActiva) => ReactNode }) {
  const sesion = useSesion();
  const router = useRouter();
  const ruta = usePathname();
  const rol = sesion.tipo === 'activa' ? sesion.sesion.rol : null;
  const motivo = sesion.tipo === 'anonima' ? sesion.motivo : undefined;

  useEffect(() => {
    if (sesion.tipo === 'desconocida') void renovarSesion();
    else if (sesion.tipo === 'anonima') router.replace(`/ingreso?volver=${encodeURIComponent(ruta)}${motivo === 'inactividad' ? '&motivo=inactividad' : ''}`);
    else if (rol && zonaDeRol(rol) !== zona) router.replace(inicioDeRol(rol));
  }, [sesion.tipo, rol, motivo, zona, ruta, router]);

  if (sesion.tipo !== 'activa' || zonaDeRol(sesion.sesion.rol) !== zona) return <EstadoVista estado="carga" titulo="Verificando tu sesión…" />;
  return <>{children(sesion.sesion)}</>;
}
