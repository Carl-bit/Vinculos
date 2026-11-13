'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { EditorPerfil } from '@/components/equipo/EditorPerfil';
import { useMiCuenta, useModulos, useSesion } from '@/lib/consultas';

/**
 * Mi perfil (diseño "Moderno A: lienzo claro con inspector flotante",
 * 2026-11-05): el perfil publico tal como lo ve el paciente, editable parte
 * por parte. Solo existe con el rol Profesional activo y el modulo Equipo (la
 * API responde 403 al perfil con ADMIN/GESTION); el resto del equipo, y la
 * cuenta madre trabajando como ADMIN, van directo a Mi cuenta, donde se puede
 * cambiar de rol para editarlo.
 */
export default function Pagina() {
  const router = useRouter();
  const sesion = useSesion();
  const cuenta = useMiCuenta();
  const modulos = useModulos();
  const c = cuenta.data;
  const rol = sesion.tipo === 'activa' ? sesion.sesion.rol : null;
  const roles = c ? [c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)] : [];
  const conPerfil = rol === 'PROFESIONAL' && roles.includes('PROFESIONAL') && !!modulos.data?.activos.includes('EQUIPO');
  const listo = !!c && !!modulos.data && !!rol;
  useEffect(() => {
    if (listo && !conPerfil) router.replace('/admin/perfil/cuenta');
  }, [listo, conPerfil, router]);
  if (!c || !listo || !conPerfil) return null;
  return (
    <div className="pt-[clamp(10px,2vw,20px)]">
      <EditorPerfil usuarioId={c.id} nombreCuenta={c.nombre ?? c.email ?? ''} agenda={!!modulos.data?.activos.includes('AGENDA')} />
    </div>
  );
}
