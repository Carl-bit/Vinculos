'use client';

import { IntegracionesAgenda } from '@/components/agenda/IntegracionesAgenda';
import { CabeceraMiPerfil } from '@/components/equipo/CabeceraMiPerfil';
import { MasDeMiPerfil, MisDatosDescripcion, MisResenas } from '@/components/equipo/MiPerfilProfesional';
import { MiCuentaAccesos } from '@/components/nucleo/MiCuentaAccesos';
import { MisPacientesEstado } from '@/components/pacientes/MisPacientesEstado';
import { useMiCuenta, useModulos, useSesion } from '@/lib/consultas';

/**
 * Mi perfil (diseño "Admin - Mi Perfil", 03b-4.1): cabecera con foto,
 * indicadores y proxima sesion; mis datos y calificaciones a la izquierda;
 * mis pacientes (solo estado administrativo) y mi cuenta a la derecha; abajo,
 * lo que el diseño no muestra y la API si tiene (tipos de atencion,
 * trayectoria, tarifas, datos para pagos, videollamada y calendario).
 */
export default function Pagina() {
  const sesion = useSesion();
  const cuenta = useMiCuenta();
  const activos = useModulos().data?.activos ?? [];
  if (sesion.tipo !== 'activa' || !cuenta.data) return null;
  const c = cuenta.data;
  const roles = [c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)];
  const profesional = roles.includes('PROFESIONAL');
  const atiende = profesional || roles.includes('PRACTICANTE');
  const rol = sesion.sesion.rol;
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  // El perfil profesional se gestiona con el rol clinico activo (la API responde 403 con ADMIN/GESTION).
  const conPerfil = profesional && rol === 'PROFESIONAL' && activos.includes('EQUIPO');
  return (
    <div className="flex flex-col gap-6 pt-[clamp(16px,3vw,32px)]">
      <CabeceraMiPerfil usuarioId={c.id} nombre={c.nombre ?? c.email ?? ''} roles={roles} rolActivo={rol} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          {conPerfil && <MisDatosDescripcion usuarioId={c.id} />}
          {conPerfil && <MisResenas />}
          {!clinico && <MiCuentaAccesos liquidaciones={false} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {atiende && clinico && <MisPacientesEstado profesionalId={c.id} />}
          {clinico && <MiCuentaAccesos liquidaciones={rol === 'PROFESIONAL' && activos.includes('COBROS')} />}
        </div>
      </div>
      {atiende && clinico && activos.includes('EQUIPO') && <MasDeMiPerfil usuarioId={c.id} practicante={rol === 'PRACTICANTE'} />}
      {atiende && clinico && activos.includes('AGENDA') && <IntegracionesAgenda />}
    </div>
  );
}
