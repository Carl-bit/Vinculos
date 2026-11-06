'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pestanas } from '@/components/ui/Pestanas';
import { api, datos } from '@/lib/api/cliente';
import { NOMBRE_ROL, useCuentasEquipo, usePracticantes, useSupervisiones, type Cuenta } from '@/lib/equipo';
import { useEquipoAgenda } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';
import { ESTADO_INTEGRANTE, checksIntegrante, estadoIntegrante, useDatosProfesionales, useTiposDocumentoPracticantes, type Check, type EstadoIntegrante } from '@/lib/validacionEquipo';

import { AlertasEquipo } from './AlertasEquipo';
import { CatalogosEquipo } from './CatalogosEquipo';
import { FichaValidacion, type Integrante } from './FichaValidacion';
import { ModeracionResenas } from './ModeracionResenas';
import { NuevaCuenta } from './NuevaCuenta';
import { PracticantesEquipo } from './PracticantesEquipo';

type Vista = 'integrantes' | 'practicantes' | 'revisiones' | 'resenas' | 'alertas';

/** Integrante con su validacion ya calculada (lista y ficha). */
interface Fila extends Integrante {
  checks?: Check[];
  estado?: EstadoIntegrante;
  bajaEn?: string | null;
}

/**
 * Equipo del centro (diseño "Equipo del centro, version 1", 2026-11-05):
 * barra flotante con secciones y contadores, resumen del equipo, lista de
 * integrantes con su estado de validacion y la ficha con la lista de
 * validacion. Solo ADMIN/GESTION; el profesional edita lo suyo en "Mi perfil".
 * Parametros: `?vista=`, `?id=` (integrante abierto) y `?nuevo=1`.
 */
export function EquipoCentro({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  const gestiona = esAdministracion(rol);
  const router = useRouter();
  const parametros = useSearchParams();
  const equipo = useEquipoValidado(rol);
  const contadores = useContadores(admin);
  const practicantesPend = equipo.filas.filter((f) => f.roles[0] === 'PRACTICANTE' && (f.estado === 'VENCIDO' || f.estado === 'POR_VALIDAR')).length;
  const vistas: { valor: Vista; etiqueta: string; n?: number }[] = [
    { valor: 'integrantes', etiqueta: 'Integrantes' },
    { valor: 'practicantes', etiqueta: 'Practicantes', n: practicantesPend },
    ...(admin
      ? [
          { valor: 'revisiones' as const, etiqueta: 'Catálogos y revisiones', n: contadores.propuestas },
          { valor: 'resenas' as const, etiqueta: 'Reseñas', n: contadores.resenas },
        ]
      : []),
    ...(gestiona ? [{ valor: 'alertas' as const, etiqueta: admin ? 'Alertas y bajas' : 'Bajas y reasignación', n: contadores.alertas }] : []),
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
    <div data-lienzo className="flex min-w-0 flex-col gap-[18px]">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-3.5">
        <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-[28px] border border-divider bg-bg py-2 pr-2 pl-4 shadow-lg">
          <h1 className="m-0 pr-1.5 text-[15px] font-black">Equipo del centro</h1>
          <Pestanas
            etiqueta="Secciones del equipo"
            tono="team"
            valor={vista}
            onChange={(v) => ir({ vista: v === 'integrantes' ? null : v })}
            pestanas={vistas}
            panelId="equipo-panel"
          />
        </div>
        {admin && (
          <Button variant="team" size="lg" icon="person_add" onClick={() => ir({ nuevo: '1' })} className="ml-auto">
            Nueva cuenta
          </Button>
        )}
      </div>
      {/* min-w-0: las listas se desplazan dentro, sin ensanchar la pagina. */}
      <div id="equipo-panel" role="tabpanel" className="mx-auto w-full max-w-[1240px] min-w-0">
        {vista === 'integrantes' && <Integrantes rol={rol} equipo={equipo} abierto={parametros.get('id')} onAbrir={(id) => ir({ id })} />}
        {vista === 'practicantes' && <PracticantesEquipo rol={rol} />}
        {vista === 'revisiones' && <CatalogosEquipo />}
        {vista === 'resenas' && <ModeracionResenas />}
        {vista === 'alertas' && <AlertasEquipo rol={rol} />}
      </div>
      {admin && (
        <NuevaCuenta abierto={parametros.get('nuevo') === '1'} onCerrar={() => ir({ nuevo: null })} onCreada={(id) => ir({ nuevo: null, vista: null, id })} />
      )}
    </div>
  );
}

/** Pendientes por seccion; mismas claves de cache que cada pestaña. */
function useContadores(admin: boolean) {
  const propuestas = useQuery({ queryKey: ['equipo', 'propuestas'], queryFn: () => datos(api.GET('/api/tipos-atencion/propuestas')), enabled: admin });
  const resenas = useQuery({ queryKey: ['equipo', 'resenas'], queryFn: () => datos(api.GET('/api/resenas')), enabled: admin });
  const alertas = useQuery({ queryKey: ['equipo', 'alertas'], queryFn: () => datos(api.GET('/api/alertas')), enabled: admin });
  const bajas = useQuery({ queryKey: ['equipo', 'bajas'], queryFn: () => datos(api.GET('/api/bajas')) });
  const porReasignar = useQuery({ queryKey: ['equipo', 'por-reasignar'], queryFn: () => datos(api.GET('/api/bajas/por-reasignar')) });
  return {
    propuestas: propuestas.data?.length ?? 0,
    resenas: (resenas.data ?? []).filter((r) => r.estado === 'PENDIENTE' || (r.reportes.length > 0 && r.estado === 'PUBLICADA')).length,
    alertas:
      (alertas.data ?? []).filter((a) => !a.atendidaEn).length + (porReasignar.data?.length ?? 0) + (bajas.data ?? []).filter((b) => !b.procesadaEn).length,
  };
}

const ORDEN_ROL: Rol[] = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'];
const GRUPO: Partial<Record<Rol, string>> = { ADMIN: 'Cuenta madre', GESTION: 'Gestión', PROFESIONAL: 'Profesionales', PRACTICANTE: 'Practicantes' };

/**
 * Integrantes con su validacion. ADMIN: cuentas (roles, activo, acceso de
 * practicantes); GESTION: directorio (sin el vencimiento del acceso).
 */
function useEquipoValidado(rol: Rol) {
  const admin = rol === 'ADMIN';
  const cuentas = useCuentasEquipo(admin);
  const directorio = useEquipoAgenda();
  const practicantes = usePracticantes();
  const supervisiones = useSupervisiones();
  const bajas = useQuery({ queryKey: ['equipo', 'bajas'], queryFn: () => datos(api.GET('/api/bajas')) });
  const origen = admin ? cuentas : directorio;
  const base: (Integrante & { cuenta?: Cuenta })[] = admin
    ? (cuentas.data ?? [])
        .filter((c) => !c.cerradaEn)
        .map((c) => ({
          id: c.id,
          nombre: c.nombre ?? c.email ?? 'Sin nombre',
          roles: [c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)],
          activo: c.activo,
          cuenta: c,
        }))
    : (directorio.data ?? []).map((m) => ({ id: m.id, nombre: m.nombre ?? 'Integrante', roles: m.roles, activo: true }));
  const pros = useDatosProfesionales(base.filter((m) => m.roles.includes('PROFESIONAL')).map((m) => m.id));
  const docs = useTiposDocumentoPracticantes(base.filter((m) => m.roles.includes('PRACTICANTE')).map((m) => m.id));
  const nombre = new Map(base.map((m) => [m.id, m.nombre]));
  const ahora = Date.now();
  const filas: Fila[] = base.map((m) => {
    const sup = (supervisiones.data ?? []).find((s) => s.practicanteId === m.id && !s.hasta);
    const practica = (practicantes.data ?? []).find((p) => p.usuarioId === m.id);
    const rolBaja = m.cuenta?.rolesAdicionales.find((r) => r.rol === 'PROFESIONAL' && r.fechaBaja && new Date(r.fechaBaja).getTime() > ahora)?.fechaBaja;
    const bajaEn = (bajas.data ?? []).find((b) => b.usuarioId === m.id && !b.procesadaEn)?.fechaEfectiva ?? rolBaja ?? null;
    const d = {
      roles: m.roles,
      activo: m.activo,
      bajaEn,
      ...pros.get(m.id),
      supervisor: supervisiones.isSuccess ? (sup ? (nombre.get(sup.supervisorId) ?? 'Profesional del centro') : null) : undefined,
      practica: practicantes.isSuccess
        ? practica
          ? { inicio: String(practica.fechaInicio), termino: String(practica.fechaTerminoPractica) }
          : null
        : undefined,
      accesoHasta: admin && m.roles.includes('PRACTICANTE') ? (m.cuenta?.fechaExpiracionAcceso ?? null) : undefined,
      documentos: docs.get(m.id),
      ahora,
    };
    const checks = checksIntegrante(d);
    return { ...m, checks, estado: estadoIntegrante(d, checks), bajaEn };
  });
  return { filas, cuentas: cuentas.data, origen };
}

type Filtro = 'todos' | 'pendientes' | 'vencidos';

function Integrantes({
  rol,
  equipo,
  abierto,
  onAbrir,
}: {
  rol: Rol;
  equipo: ReturnType<typeof useEquipoValidado>;
  abierto: string | null;
  onAbrir: (id: string) => void;
}) {
  const admin = rol === 'ADMIN';
  const [busqueda, setBusqueda] = useState('');
  const buscador = useRef<HTMLInputElement>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const { filas, origen } = equipo;
  const texto = busqueda.trim().toLocaleLowerCase('es');
  const visibles = filas.filter(
    (m) =>
      (!texto || m.nombre.toLocaleLowerCase('es').includes(texto)) &&
      (filtro === 'todos' || (filtro === 'pendientes' ? m.estado === 'POR_VALIDAR' : m.estado === 'VENCIDO')),
  );
  const elegido = filas.find((m) => m.id === abierto) ?? visibles[0] ?? filas[0];
  const cuenta = (n: EstadoIntegrante) => filas.filter((f) => f.estado === n).length;
  const resumen = [
    { n: filas.length, l: filas.length === 1 ? 'integrante' : 'integrantes', c: 'bg-neutral-200 text-neutral-800' },
    { n: cuenta('HABILITADO'), l: 'habilitados', c: 'bg-accent-2-200 text-accent-2-900' },
    { n: cuenta('POR_VALIDAR'), l: 'por validar', c: 'bg-pendiente-100 text-pendiente-900' },
    { n: cuenta('VENCIDO'), l: cuenta('VENCIDO') === 1 ? 'vencido' : 'vencidos', c: 'bg-accent-200 text-accent-900' },
  ];

  return (
    <EstadoConsulta
      consulta={{ isPending: origen.isPending, error: origen.error, data: filas, refetch: origen.refetch }}
      vacio={(l) => l.length === 0}
      textoVacio="Todavía no hay integrantes"
    >
      {() => (
        <div className="flex min-w-0 flex-col gap-[18px]">
          <ul aria-label="Resumen del equipo" className="m-0 flex list-none flex-wrap justify-center gap-2.5 p-0">
            {resumen.map((r) => (
              <li key={r.l} className={`inline-flex items-baseline gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold ${r.c}`}>
                <strong className="text-[18px] font-black">{r.n}</strong>
                {r.l}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-start gap-5">
            <section
              aria-labelledby="t-integrantes"
              className="flex w-full flex-col gap-2 rounded-lg border border-divider bg-bg/95 p-3.5 shadow-lg backdrop-blur-[10px] lg:sticky lg:top-5 lg:w-[300px] lg:flex-none"
            >
              <h2 id="t-integrantes" className="m-0 px-1.5 pt-1 text-[17px] font-black">
                Integrantes
              </h2>
              {/* Filtra mientras se escribe; el boton enfoca el campo (Enter no recarga). */}
              <form role="search" onSubmit={(e) => e.preventDefault()} className="relative flex">
                <input
                  ref={buscador}
                  type="search"
                  aria-label="Buscar integrante"
                  placeholder="Buscar por nombre"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="min-h-[42px] w-full rounded-[14px] border border-divider bg-neutral-100 pr-11 pl-3.5 text-[13px] focus-visible:border-accent-500 [&::-webkit-search-cancel-button]:hidden"
                />
                <button
                  type="submit"
                  aria-label="Buscar"
                  onClick={() => buscador.current?.focus()}
                  className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-[10px] text-neutral-800 hover:bg-neutral-200"
                >
                  <Icon name="search" size={18} />
                </button>
              </form>
              <div role="group" aria-label="Filtrar integrantes" className="flex flex-wrap gap-1">
                {(
                  [
                    ['todos', 'Todos'],
                    ['pendientes', 'Por validar'],
                    ['vencidos', 'Vencidos'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={filtro === v}
                    onClick={() => setFiltro(v)}
                    className={`min-h-8 cursor-pointer rounded-full px-3 text-[12px] font-extrabold ${filtro === v ? 'bg-text text-neutral-100' : 'bg-neutral-200 hover:bg-neutral-300'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {visibles.length === 0 && <p className="m-0 px-1.5 py-2 text-[13px] font-semibold text-neutral-800">Nadie coincide con el filtro.</p>}
              {ORDEN_ROL.map((r) => {
                const grupo = visibles.filter((m) => m.roles[0] === r);
                if (grupo.length === 0) return null;
                return (
                  <div key={r} role="group" aria-label={GRUPO[r]} className="flex flex-col gap-1">
                    <span className="px-2 pt-2 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">{GRUPO[r]}</span>
                    {grupo.map((m) => {
                      const actual = elegido?.id === m.id;
                      const e = m.estado ? ESTADO_INTEGRANTE[m.estado] : null;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          aria-current={actual ? 'true' : undefined}
                          onClick={() => onAbrir(m.id)}
                          className={`flex min-h-[54px] w-full cursor-pointer items-center gap-2.5 rounded-[16px] px-2.5 py-1.5 text-left transition-colors duration-200 ${
                            actual ? 'bg-neutral-100 shadow-md' : 'hover:bg-neutral-200'
                          }`}
                        >
                          <Avatar name={m.nombre} size={36} tone={m.roles[0] === 'PRACTICANTE' ? 'patient' : 'team'} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <strong className="truncate text-[13px]">{m.nombre}</strong>
                            <span className="truncate text-[11.5px] font-semibold text-neutral-700">{m.roles.map((x) => NOMBRE_ROL[x]).join(' · ')}</span>
                          </span>
                          <span
                            className={`flex-none rounded-full px-[7px] py-0.5 text-[10.5px] font-extrabold ${
                              !e
                                ? 'text-neutral-700'
                                : e.tono === 'positivo'
                                  ? 'bg-accent-2-200 text-accent-2-900'
                                  : m.estado === 'POR_VALIDAR'
                                    ? 'bg-pendiente-100 text-pendiente-900'
                                    : e.tono === 'atencion'
                                      ? 'bg-accent-200 text-accent-900'
                                      : 'bg-neutral-200 text-neutral-800'
                            }`}
                          >
                            {e?.chip ?? '…'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </section>
            <div className="min-w-0 flex-[999_1_560px]">
              {elegido && (
                <FichaValidacion
                  key={elegido.id}
                  miembro={elegido}
                  cuenta={admin ? equipo.cuentas?.find((c) => c.id === elegido.id) : undefined}
                  rol={rol}
                  checks={elegido.checks}
                  estado={elegido.estado}
                  bajaEn={elegido.bajaEn}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </EstadoConsulta>
  );
}
