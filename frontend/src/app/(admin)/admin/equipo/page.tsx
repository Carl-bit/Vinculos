'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { EquipoCentro } from '@/components/equipo/EquipoCentro';
import { useSesion } from '@/lib/consultas';
import { esAdministracion } from '@/lib/roles';

/**
 * Equipo: integrantes, practicantes, catalogos, reseñas y alertas. Solo
 * ADMIN/GESTION (2026-10-29); el profesional edita lo suyo en "Mi perfil" y
 * la supervision de practicantes esta en Fichas y Pacientes.
 */
function Equipo() {
  const sesion = useSesion();
  const router = useRouter();
  const parametros = useSearchParams();
  const rol = sesion.tipo === 'activa' ? sesion.sesion.rol : null;
  const permitido = rol !== null && esAdministracion(rol);
  useEffect(() => {
    if (rol && !permitido) router.replace(parametros.get('vista') === 'supervision' ? '/admin/fichas?vista=supervision' : '/admin/perfil');
  }, [rol, permitido, parametros, router]);
  if (!rol || !permitido) return null;
  return <EquipoCentro rol={rol} />;
}

export default function Pagina() {
  return (
    <Suspense>
      <Equipo />
    </Suspense>
  );
}
