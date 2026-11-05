'use client';

import { Suspense } from 'react';

import { IntegracionesAgenda } from '@/components/agenda/IntegracionesAgenda';
import { MiAcuerdo, MisLiquidaciones } from '@/components/cobros/MiAcuerdo';
import { CambiarAProfesional } from '@/components/equipo/CambiarAProfesional';
import { FichaIntegrante } from '@/components/equipo/FichaIntegrante';
import { MiTrayectoria, MisDatosPrivados } from '@/components/equipo/MiPerfilProfesional';
import { RegistroSisPanel } from '@/components/equipo/RegistroSis';
import { AvisosEquipo } from '@/components/nucleo/AvisosEquipo';
import { MiCuentaEquipo } from '@/components/nucleo/MiCuentaEquipo';
import { ProtocoloEquipo } from '@/components/nucleo/ProtocoloEquipo';
import { MisPacientesEstado } from '@/components/pacientes/MisPacientesEstado';
import { CambioPassword } from '@/components/shared/CambioPassword';
import { SeccionesCuenta, type SeccionCuenta } from '@/components/shared/SeccionesCuenta';
import { SegundoFactorCuenta } from '@/components/shared/SegundoFactorCuenta';
import { Badge } from '@/components/ui/Badge';
import { BarraFlotante, LIENZO, SeparadorBarra } from '@/components/ui/BarraFlotante';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { useProtocoloEquipo } from '@/lib/centro';
import { useMiCuenta, useModulos, useSesion } from '@/lib/consultas';

/**
 * Mi cuenta (diseño "Mi cuenta en estilo Moderno A", 2026-11-05): todo lo
 * privado del integrante, que nunca sale en el perfil publico. Mis datos
 * (contacto, seguridad), Mi trabajo (pacientes, avisos, videollamada,
 * protocolo) y Dinero (acuerdo, datos para pagos, liquidaciones). Cada
 * seccion aparece solo si el rol activo y los modulos la tienen.
 */
export default function Pagina() {
  const sesion = useSesion();
  const cuenta = useMiCuenta();
  const activos = useModulos().data?.activos ?? [];
  const protocolo = useProtocoloEquipo().data;
  if (sesion.tipo !== 'activa' || !cuenta.data) return null;
  const c = cuenta.data;
  const roles = [c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)];
  const rol = sesion.sesion.rol;
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const profesional = rol === 'PROFESIONAL';
  const equipo = activos.includes('EQUIPO');
  const conPerfil = profesional && equipo;
  // Cuenta madre con rol Profesional trabajando como ADMIN/GESTION: su ficha del equipo y el cambio de rol.
  const cuentaMadre = roles.includes('PROFESIONAL') && !clinico && equipo;
  const cobros = profesional && activos.includes('COBROS');

  const secciones = (
    [
      {
        id: 'contacto',
        grupo: 'Mis datos',
        titulo: 'Datos de contacto',
        descripcion: 'Los usa el centro para coordinarse contigo. No aparecen en tu perfil público.',
        contenido: <MiCuentaEquipo />,
      },
      {
        id: 'seguridad',
        grupo: 'Mis datos',
        titulo: 'Seguridad',
        descripcion: 'Acceso a tu cuenta.',
        contenido: (
          <>
            <CambioPassword tono="team" />
            <SegundoFactorCuenta tono="team" />
          </>
        ),
      },
      cuentaMadre && {
        id: 'perfil-profesional',
        grupo: 'Mis datos',
        titulo: 'Mi perfil profesional',
        descripcion: 'Tu ficha en el equipo. El perfil público se edita trabajando como Profesional.',
        contenido: (
          <>
            <CambiarAProfesional rolActivo={rol} />
            <FichaIntegrante miembro={{ id: c.id, nombre: c.nombre ?? c.email ?? '', roles }} rol={rol} propio />
          </>
        ),
      },
      rol === 'PRACTICANTE' &&
        equipo && {
          id: 'formacion',
          grupo: 'Mis datos',
          titulo: 'Mi formación',
          descripcion: 'Tu supervisión y tu formación. Los practicantes no tienen perfil público.',
          contenido: (
            <>
              <RegistroSisPanel profesionalId={c.id} practicante propio admin={false} />
              <MiTrayectoria usuarioId={c.id} />
            </>
          ),
        },
      clinico && {
        id: 'pacientes',
        grupo: 'Mi trabajo',
        titulo: 'Mis pacientes',
        descripcion: 'Próxima sesión y estado administrativo de cada uno. Lo clínico vive en la ficha.',
        contenido: <MisPacientesEstado profesionalId={c.id} />,
      },
      {
        id: 'avisos',
        grupo: 'Mi trabajo',
        titulo: 'Avisos y recordatorios',
        descripcion: 'Qué te avisa Vinculos por correo. La bandeja registra todo.',
        contenido: <AvisosEquipo />,
      },
      clinico &&
        activos.includes('AGENDA') && {
          id: 'video',
          grupo: 'Mi trabajo',
          titulo: 'Sala de videollamada',
          descripcion: 'El paciente recibe tu enlace al confirmar una hora online. Aquí también conectas tu calendario.',
          contenido: <IntegracionesAgenda />,
        },
      {
        id: 'protocolo',
        grupo: 'Mi trabajo',
        titulo: 'Protocolo del centro',
        descripcion: 'Solo lo ve el equipo. Una versión nueva vuelve a quedar pendiente.',
        chip: protocolo?.vigente && !protocolo.leidoEn ? { texto: 'Sin leer', tono: 'atencion' } : undefined,
        contenido: <ProtocoloEquipo />,
      },
      clinico &&
        equipo && {
          id: 'pagos',
          grupo: 'Dinero',
          titulo: 'Pagos y liquidaciones',
          descripcion: 'Vinculos calcula; el dinero lo mueve el centro o tu propia cuenta.',
          contenido: (
            <>
              {cobros && <MiAcuerdo />}
              <MisDatosPrivados usuarioId={c.id} />
              {cobros && <MisLiquidaciones />}
            </>
          ),
        },
    ] as (SeccionCuenta | false)[]
  ).filter((s): s is SeccionCuenta => !!s);

  return (
    <div className={`${LIENZO} -mx-[clamp(12px,2vw,24px)] mt-[clamp(10px,2vw,20px)] flex flex-col gap-5 px-[clamp(12px,2vw,24px)] pt-4 pb-10`}>
      <BarraFlotante etiqueta="Mi cuenta">
        <strong className="text-[15px] font-black">Mi cuenta</strong>
        <Badge tono="neutro">
          <Icon name="lock" size={12} />
          Privado
        </Badge>
        <SeparadorBarra />
        {conPerfil && (
          <ButtonLink href="/admin/perfil" variant="team" className="!min-h-10 !py-2">
            Volver a mi perfil público
          </ButtonLink>
        )}
        {clinico && activos.includes('AGENDA') && (
          <ButtonLink href="/admin/agenda" variant="ghost" className="!min-h-10 !py-2">
            Ver mi agenda
          </ButtonLink>
        )}
        <ButtonLink href={roles.includes('ADMIN') || roles.includes('GESTION') ? '/admin/equipo' : '/equipo'} variant="ghost" className="!min-h-10 !py-2">
          Ver el equipo
        </ButtonLink>
      </BarraFlotante>
      <Suspense>
        <SeccionesCuenta secciones={secciones} />
      </Suspense>
    </div>
  );
}
