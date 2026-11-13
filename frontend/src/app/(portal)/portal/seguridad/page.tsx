import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AvisosPortal } from '@/components/nucleo/AvisosPortal';
import { ContactosEmergenciaPortal } from '@/components/pacientes/ContactosEmergenciaPortal';
import { MisDatos } from '@/components/pacientes/MisDatos';
import { CambioPassword } from '@/components/shared/CambioPassword';
import { Encabezado } from '@/components/shared/Encabezado';
import { SeccionesCuenta, type SeccionCuenta } from '@/components/shared/SeccionesCuenta';
import { SegundoFactorCuenta } from '@/components/shared/SegundoFactorCuenta';

export const metadata: Metadata = { title: 'Mis datos y seguridad' };

/**
 * Correcciones 2026-11-11: como la configuracion del centro, se elige una
 * seccion y se ve solo esa (sin scroll innecesario). La seccion va en la URL
 * (?seccion=): los avisos y el inicio enlazan directo a la que corresponde.
 */
const SECCIONES: SeccionCuenta[] = [
  { id: 'datos', grupo: 'Mis datos', titulo: 'Datos personales', descripcion: 'Teléfono y correo', contenido: <MisDatos /> },
  {
    id: 'contactos',
    grupo: 'Mis datos',
    titulo: 'Contactos de emergencia',
    descripcion: 'A quién llamar si lo necesitas',
    contenido: <ContactosEmergenciaPortal />,
  },
  { id: 'avisos', grupo: 'Mis datos', titulo: 'Avisos por correo', descripcion: 'Qué te llega también por correo', contenido: <AvisosPortal /> },
  { id: 'clave', grupo: 'Seguridad', titulo: 'Contraseña', descripcion: 'Cambiar tu contraseña', contenido: <CambioPassword /> },
  { id: 'factor', grupo: 'Seguridad', titulo: 'Verificación en dos pasos', descripcion: 'Código al ingresar', contenido: <SegundoFactorCuenta /> },
];

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Mis datos y seguridad" bajada="Elige una sección. Si olvidas cerrar la sesión, se cierra sola tras 30 minutos sin actividad." />
      <Suspense>
        <SeccionesCuenta secciones={SECCIONES} />
      </Suspense>
    </>
  );
}
