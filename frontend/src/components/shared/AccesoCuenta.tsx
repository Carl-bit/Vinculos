'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { useSesion } from '@/lib/consultas';
import { inicioDeRol } from '@/lib/roles';
import { renovarSesion } from '@/lib/sesion';

/** Pildora oscura del diseño "Moderno" (tinta sobre la barra translucida). */
const CLASE =
  'acceso-cuenta ml-auto flex min-h-11 items-center rounded-full bg-tinta px-[18px] text-sm font-bold whitespace-nowrap text-neutral-100 transition-colors duration-200 hover:bg-neutral-800 hover:text-neutral-100 md:ml-0';

/**
 * Acceso del header publico (03b-4.1): al cargar intenta renovar la sesion en
 * silencio con la cookie de refresh; con sesion activa ofrece volver al
 * panel o al portal en vez de pedir el ingreso otra vez. Punto 2: en el
 * propio login el boton alterna el perfil ("Ingresar como profesional" /
 * "Ingresar como paciente"); el primer ingreso muestra el de pacientes.
 */
export function AccesoCuenta() {
  const sesion = useSesion();
  const ruta = usePathname();
  const parametros = useSearchParams();
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
  if (ruta === '/ingreso') {
    const equipo = parametros.get('perfil') === 'equipo';
    const q = new URLSearchParams(parametros);
    if (equipo) q.delete('perfil');
    else q.set('perfil', 'equipo');
    const texto = q.toString();
    return (
      <Link href={texto ? `/ingreso?${texto}` : '/ingreso'} replace scroll={false} className={CLASE}>
        {equipo ? 'Ingresar como paciente' : 'Ingresar como profesional'}
      </Link>
    );
  }
  return (
    <Link href="/ingreso" className={CLASE}>
      Iniciar sesión
    </Link>
  );
}
