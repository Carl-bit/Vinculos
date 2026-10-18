'use client';

import { IntegracionesAgenda } from '@/components/agenda/IntegracionesAgenda';
import { MiPerfilProfesional } from '@/components/equipo/MiPerfilProfesional';
import { MiCuentaEquipo } from '@/components/nucleo/MiCuentaEquipo';
import { CambioPassword } from '@/components/shared/CambioPassword';
import { Encabezado } from '@/components/shared/Encabezado';
import { useMiCuenta, useModulos, useSesion } from '@/lib/consultas';

/** Mi perfil (diseño "Admin - Mi Perfil"): cuenta, contraseña y, si atiende, perfil profesional, sala y calendario. */
export default function Pagina() {
  const sesion = useSesion();
  const cuenta = useMiCuenta();
  const activos = useModulos().data?.activos ?? [];
  if (sesion.tipo !== 'activa') return null;
  const roles = [cuenta.data?.rol, ...(cuenta.data?.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol) ?? [])];
  const atiende = roles.includes('PROFESIONAL') || roles.includes('PRACTICANTE');
  return (
    <>
      <Encabezado
        tono="team"
        titulo="Mi perfil"
        bajada={atiende ? 'Tu cuenta, tu perfil público y lo que necesitas para atender.' : 'Tus datos de cuenta y tu contraseña.'}
      />
      <div className="flex flex-col gap-6">
        <MiCuentaEquipo />
        {atiende && cuenta.data && activos.includes('EQUIPO') && (
          <MiPerfilProfesional usuarioId={cuenta.data.id} practicante={!roles.includes('PROFESIONAL')} />
        )}
        {atiende && activos.includes('AGENDA') && <IntegracionesAgenda />}
        <CambioPassword tono="team" />
      </div>
    </>
  );
}
