'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { useSesion } from '@/lib/consultas';
import { inicioDeRol } from '@/lib/roles';
import { renovarSesion } from '@/lib/sesion';

const CLASE =
  'ml-auto rounded-full border-[1.5px] border-neutral-400 px-5 py-2.5 text-sm font-extrabold whitespace-nowrap text-text transition-colors duration-200 hover:border-accent-500 hover:bg-accent-200 hover:text-text md:ml-0';

/**
 * Acceso del header publico (03b-4.1): al cargar intenta renovar la sesion en
 * silencio con la cookie de refresh; con sesion activa ofrece volver al
 * panel o al portal en vez de pedir el ingreso otra vez.
 */
export function AccesoCuenta() {
  const sesion = useSesion();
  useEffect(() => {
    if (sesion.tipo === 'desconocida') void renovarSesion();
  }, [sesion.tipo]);
  if (sesion.tipo === 'activa') {
    return (
      <Link href={inicioDeRol(sesion.sesion.rol)} className={CLASE}>
        {sesion.sesion.rol === 'PACIENTE' || sesion.sesion.rol === 'RESPONSABLE' ? 'Ir a mi cuenta' : 'Ir a mi panel'}
      </Link>
    );
  }
  return (
    <Link href="/ingreso" className={CLASE}>
      Iniciar sesión
    </Link>
  );
}
