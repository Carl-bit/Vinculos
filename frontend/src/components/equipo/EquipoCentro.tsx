'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Encabezado } from '@/components/shared/Encabezado';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Field, Input } from '@/components/ui/Field';
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
      <div className="flex min-w-0 flex-col gap-5">
        <Pestanas
          etiqueta="Secciones del equipo"
          tono="team"
          valor={vista}
          onChange={(v) => ir({ vista: v === 'integrantes' ? null : v })}
          pestanas={vistas}
          panelId="equipo-panel"
        />
        {/* min-w-0: la tira se desplaza dentro, sin ensanchar la pagina. */}
        <div id="equipo-panel" role="tabpanel" className="min-w-0">
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

interface Miembro {
  id: string;
  nombre: string;
  roles: Rol[];
  activo: boolean;
}

/** Orden de los grupos de la tira (por rol principal). */
const ORDEN_ROL: Rol[] = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'];
const BUSCAR_DESDE = 8;

/** Preferencia sin datos sensibles: tira o lista. */
const CLAVE_VISTA = 'vinculos_vista_equipo';
const vistaGuardada = (): 'tira' | 'lista' => {
  try {
    return localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'tira';
  } catch {
    return 'tira';
  }
};

/**
 * Tira de integrantes (diseño "Admin - Perfil Profesional", 03b-4.1
 * pendiente 1): fila con desplazamiento lateral, agrupada por rol principal,
 * con avatar, nombre, rol y un punto de estado. Con mas de 8 integrantes
 * aparece la busqueda.
 */
function TiraEquipo({ miembros, elegido, onAbrir }: { miembros: Miembro[]; elegido?: string; onAbrir: (id: string) => void }) {
  const grupos = ORDEN_ROL.map((rol) => ({ rol, miembros: miembros.filter((m) => m.roles[0] === rol) })).filter((g) => g.miembros.length > 0);
  return (
    <div className="relative flex gap-5 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {grupos.map((g) => (
        <div key={g.rol} role="group" aria-label={NOMBRE_ROL[g.rol]} className="flex flex-none flex-col gap-2">
          <span className="px-1 text-[11px] font-extrabold tracking-[0.12em] text-neutral-800 uppercase">{NOMBRE_ROL[g.rol]}</span>
          <ul className="m-0 flex list-none gap-2.5 p-0">
            {g.miembros.map((m) => {
              const actual = elegido === m.id;
              return (
                <li key={m.id} className="flex">
                  <button
                    type="button"
                    aria-current={actual ? 'true' : undefined}
                    onClick={() => onAbrir(m.id)}
                    className={`flex w-[118px] flex-none cursor-pointer flex-col items-center gap-1.5 rounded-[18px] border px-2.5 pt-3 pb-2.5 text-center transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent-700 ${
                      actual ? 'border-accent-500 bg-accent-200' : 'border-divider bg-bg hover:border-accent-500'
                    }`}
                  >
                    <span className="relative">
                      <Avatar name={m.nombre} size={52} />
                      <span
                        aria-hidden
                        className={`absolute right-0 bottom-0 size-3.5 rounded-full border-2 border-bg ${m.activo ? 'bg-accent-2-600' : 'bg-neutral-500'}`}
                      />
                    </span>
                    <span className="line-clamp-2 w-full text-[13px] leading-tight font-extrabold">{m.nombre}</span>
                    <span className="w-full truncate text-[12px] font-semibold text-neutral-800">{m.roles.map((r) => NOMBRE_ROL[r]).join(' · ')}</span>
                    <span className="sr-only">{m.activo ? 'Cuenta activa' : 'Cuenta inactiva'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Integrantes({ rol, abierto, onAbrir }: { rol: Rol; abierto: string | null; onAbrir: (id: string) => void }) {
  const admin = rol === 'ADMIN';
  const gestiona = esAdministracion(rol);
  const cuentas = useCuentasEquipo(admin);
  const directorio = useEquipoAgenda();
  const origen = admin ? cuentas : directorio;
  const [modo, setModoEstado] = useState<'tira' | 'lista'>(vistaGuardada);
  const [busqueda, setBusqueda] = useState('');
  const setModo = (m: 'tira' | 'lista') => {
    setModoEstado(m);
    try {
      localStorage.setItem(CLAVE_VISTA, m);
    } catch {
      // Almacen bloqueado: la preferencia dura solo esta visita.
    }
  };
  const todos: Miembro[] = admin
    ? (cuentas.data ?? []).map((c) => ({
        id: c.id,
        nombre: c.nombre ?? c.email ?? 'Sin nombre',
        roles: [c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)],
        activo: c.activo && !c.cerradaEn,
      }))
    : (directorio.data ?? []).map((m) => ({ id: m.id, nombre: m.nombre ?? 'Integrante', roles: m.roles, activo: true }));
  const texto = busqueda.trim().toLocaleLowerCase('es');
  const miembros = texto ? todos.filter((m) => m.nombre.toLocaleLowerCase('es').includes(texto)) : todos;
  const elegido = todos.find((m) => m.id === abierto) ?? (gestiona ? miembros[0] : undefined);
  const tira = gestiona && modo === 'tira';

  return (
    <EstadoConsulta
      consulta={{ isPending: origen.isPending, error: origen.error, data: miembros, refetch: origen.refetch }}
      vacio={(l) => l.length === 0}
      textoVacio="Todavía no hay integrantes"
    >
      {() => (
        <div className="flex min-w-0 flex-col gap-4">
          {gestiona && (
            <div className="flex flex-wrap items-end gap-3">
              {todos.length > BUSCAR_DESDE && (
                <Field label="Buscar integrante">
                  {(x) => (
                    <Input {...x} type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre" className="!w-[240px]" />
                  )}
                </Field>
              )}
              <div className="ml-auto">
                <ControlSegmentado
                  etiqueta="Ver integrantes como"
                  valor={modo}
                  tono="team"
                  onChange={setModo}
                  opciones={[
                    { valor: 'tira', etiqueta: 'Tira', icono: 'view_week' },
                    { valor: 'lista', etiqueta: 'Ver lista', icono: 'menu' },
                  ]}
                />
              </div>
            </div>
          )}
          {gestiona && miembros.length === 0 && <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Nadie coincide con «{busqueda}».</p>}
          {tira && <TiraEquipo miembros={miembros} elegido={elegido?.id} onAbrir={onAbrir} />}
          <div className={tira ? '' : gestiona ? 'grid items-start gap-5 lg:grid-cols-[300px_1fr]' : ''}>
            {!tira && (
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
            )}
            {gestiona && elegido && (
              <FichaIntegrante key={elegido.id} miembro={elegido} cuenta={admin ? cuentas.data?.find((c) => c.id === elegido.id) : undefined} rol={rol} />
            )}
          </div>
        </div>
      )}
    </EstadoConsulta>
  );
}
