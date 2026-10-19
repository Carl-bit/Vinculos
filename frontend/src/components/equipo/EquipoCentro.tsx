'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Encabezado } from '@/components/shared/Encabezado';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pestanas } from '@/components/ui/Pestanas';
import { useMiCuenta } from '@/lib/consultas';
import { NOMBRE_ROL, useCuentasEquipo, useSupervisiones } from '@/lib/equipo';
import { useEquipoAgenda } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { AlertasEquipo } from './AlertasEquipo';
import { CatalogosEquipo } from './CatalogosEquipo';
import { FichaIntegrante } from './FichaIntegrante';
import { ModeracionResenas } from './ModeracionResenas';
import { NuevaCuenta } from './NuevaCuenta';
import { PracticantesEquipo } from './PracticantesEquipo';
import { SupervisionCasos } from './SupervisionCasos';

type Vista = 'integrantes' | 'practicantes' | 'supervision' | 'revisiones' | 'resenas' | 'alertas';

/**
 * Equipo (diseño "Admin - Perfil Profesional"): integrantes con su perfil y
 * cuenta, practicantes, catalogos y revisiones, moderacion de reseñas y
 * alertas. El profesional ve el directorio y edita lo suyo en "Mi perfil".
 * Parametros: `?vista=`, `?id=` (integrante abierto) y `?nuevo=1`.
 */
export function EquipoCentro({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  const gestiona = esAdministracion(rol);
  const router = useRouter();
  const parametros = useSearchParams();
  const cuenta = useMiCuenta();
  const supervisiones = useSupervisiones();
  // Supervision seudonimizada: solo quien supervisa a un practicante vigente.
  const supervisa = rol === 'PROFESIONAL' && (supervisiones.data ?? []).some((s) => s.supervisorId === cuenta.data?.id && !s.hasta);
  const vistas: { valor: Vista; etiqueta: string }[] = [
    { valor: 'integrantes', etiqueta: 'Integrantes' },
    { valor: 'practicantes', etiqueta: 'Practicantes' },
    ...(supervisa ? ([{ valor: 'supervision', etiqueta: 'Supervisión' }] as const) : []),
    ...(admin
      ? ([
          { valor: 'revisiones', etiqueta: 'Catálogos y revisiones' },
          { valor: 'resenas', etiqueta: 'Reseñas' },
        ] as const)
      : []),
    ...(gestiona ? ([{ valor: 'alertas', etiqueta: admin ? 'Alertas y bajas' : 'Bajas y reasignación' }] as const) : []),
  ];
  const vista = vistas.find((v) => v.valor === parametros.get('vista'))?.valor ?? 'integrantes';
  const ir = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(parametros.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    router.replace(q ? `/admin/equipo?${q}` : '/admin/equipo', { scroll: false });
  };

  return (
    <>
      <Encabezado
        tono="team"
        titulo="Equipo del centro"
        bajada={gestiona ? 'Integrantes, perfiles, accesos y revisiones.' : 'Quiénes forman el equipo. Tu perfil se edita en "Mi perfil".'}
        accion={
          admin ? (
            <Button variant="team" icon="person_add" onClick={() => ir({ nuevo: '1' })}>
              Nueva cuenta
            </Button>
          ) : (
            <Link href="/admin/perfil" className="text-[13.5px] font-extrabold text-accent-700 underline underline-offset-2">
              Ir a mi perfil
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-5">
        <Pestanas
          etiqueta="Secciones del equipo"
          tono="team"
          valor={vista}
          onChange={(v) => ir({ vista: v === 'integrantes' ? null : v })}
          pestanas={vistas}
          panelId="equipo-panel"
        />
        <div id="equipo-panel" role="tabpanel">
          {vista === 'integrantes' && <Integrantes rol={rol} abierto={parametros.get('id')} onAbrir={(id) => ir({ id })} />}
          {vista === 'practicantes' && <PracticantesEquipo rol={rol} />}
          {vista === 'supervision' && <SupervisionCasos />}
          {vista === 'revisiones' && <CatalogosEquipo />}
          {vista === 'resenas' && <ModeracionResenas />}
          {vista === 'alertas' && <AlertasEquipo rol={rol} />}
        </div>
      </div>
      {admin && (
        <NuevaCuenta abierto={parametros.get('nuevo') === '1'} onCerrar={() => ir({ nuevo: null })} onCreada={(id) => ir({ nuevo: null, vista: null, id })} />
      )}
    </>
  );
}

function Integrantes({ rol, abierto, onAbrir }: { rol: Rol; abierto: string | null; onAbrir: (id: string) => void }) {
  const admin = rol === 'ADMIN';
  const gestiona = esAdministracion(rol);
  const cuentas = useCuentasEquipo(admin);
  const directorio = useEquipoAgenda();
  const origen = admin ? cuentas : directorio;
  const miembros = admin
    ? (cuentas.data ?? []).map((c) => ({
        id: c.id,
        nombre: c.nombre ?? c.email ?? 'Sin nombre',
        roles: [c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)],
        activo: c.activo && !c.cerradaEn,
      }))
    : (directorio.data ?? []).map((m) => ({ id: m.id, nombre: m.nombre ?? 'Integrante', roles: m.roles, activo: true }));
  const elegido = miembros.find((m) => m.id === abierto) ?? (gestiona ? miembros[0] : undefined);

  return (
    <EstadoConsulta
      consulta={{ isPending: origen.isPending, error: origen.error, data: miembros, refetch: origen.refetch }}
      vacio={(l) => l.length === 0}
      textoVacio="Todavía no hay integrantes"
    >
      {() => (
        <div className={gestiona ? 'grid items-start gap-5 lg:grid-cols-[300px_1fr]' : ''}>
          <ul
            className={`m-0 list-none p-0 ${gestiona ? 'flex flex-col gap-1.5 lg:sticky lg:top-6' : 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3'}`}
          >
            {miembros.map((m) => {
              const actual = gestiona && elegido?.id === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={!gestiona}
                    aria-current={actual ? 'true' : undefined}
                    onClick={() => onAbrir(m.id)}
                    className={`flex w-full items-center gap-3 rounded-[16px] border px-3.5 py-2.5 text-left transition-colors duration-200 ${
                      actual ? 'border-accent-500 bg-accent-200' : 'border-divider bg-bg hover:border-accent-500 disabled:hover:border-divider'
                    } ${gestiona ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <Avatar name={m.nombre} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold">{m.nombre}</span>
                      <span className="block truncate text-[12px] font-semibold text-neutral-700">{m.roles.map((r) => NOMBRE_ROL[r]).join(' · ')}</span>
                    </span>
                    {!m.activo && <Badge tono="neutro">Inactiva</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
          {gestiona && elegido && (
            <FichaIntegrante key={elegido.id} miembro={elegido} cuenta={admin ? cuentas.data?.find((c) => c.id === elegido.id) : undefined} rol={rol} />
          )}
        </div>
      )}
    </EstadoConsulta>
  );
}
