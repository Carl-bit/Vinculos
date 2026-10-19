'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { menuVisible, type ItemMenu } from '@/lib/navegacion';
import { esAdministracion, NOMBRE_ROL } from '@/lib/roles';
import type { SesionActiva } from '@/lib/sesion';
import { BotonSalir } from './BotonSalir';
import { ProveedorEquipoActivo, SelectorEquipo } from './EquipoActivo';
import { Marca } from './Marca';
import { SelectorRol } from './SelectorRol';

const GRUPOS = [
  { id: 'principal', titulo: null },
  { id: 'modulos', titulo: 'Módulos' },
  { id: 'centro', titulo: 'Centro' },
] as const;

function Enlace({ item, activo }: { item: ItemMenu; activo: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={activo ? 'page' : undefined}
      className={`group relative flex min-h-10 items-center gap-[11px] rounded-[10px] px-2.5 py-[9px] text-sm transition-[background-color,color] duration-200 ease-out ${
        activo ? 'bg-accent-2-200 font-extrabold text-accent-2-700 hover:text-accent-2-700' : 'font-semibold text-text hover:bg-accent-200 hover:text-text'
      }`}
    >
      {/* Indicador del item activo: pastilla a la izquierda (ui-ux-pro-max: estado activo visible). */}
      <span
        aria-hidden="true"
        className={`absolute top-1/2 -left-4 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent-2-600 transition-transform duration-200 ease-out ${activo ? 'scale-y-100' : 'scale-y-0'}`}
      />
      <Icon name={item.icono} size={19} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
      <span className="flex-1">{item.etiqueta}</span>
    </Link>
  );
}

/** Shell del backoffice (diseño "Admin - Dashboard"): sidebar con menu dinamico, rol activo y equipo. */
export function LayoutAdmin({ sesion, children }: { sesion: SesionActiva; children: ReactNode }) {
  const ruta = usePathname();
  const modulos = useModulos();
  const cuenta = useMiCuenta();
  const items = menuVisible('admin', sesion.rol, modulos.data?.activos ?? []);
  const nombre = cuenta.data?.nombre ?? '';
  const activo = (href: string) => (href === '/admin' ? ruta === href : ruta.startsWith(href) && href !== '/');
  // Movil: el menu se despliega con un boton y se cierra al navegar (en escritorio siempre visible).
  const [menuAbierto, setMenuAbierto] = useState(false);
  useEffect(() => setMenuAbierto(false), [ruta]);

  return (
    <ProveedorEquipoActivo key={sesion.rol}>
      <div className="min-h-screen bg-neutral-300 md:grid md:grid-cols-[246px_1fr]">
        <aside className="z-[2] flex flex-col gap-[26px] border-r border-divider bg-bg px-4 pt-[22px] pb-6 shadow-md md:sticky md:top-0 md:h-screen md:overflow-y-auto">
          <div className="flex items-center justify-between gap-3 px-2">
            <Marca href="/admin" size="sm" />
            <div className="flex items-center gap-2 md:hidden">
              {/* El rol activo siempre visible, tambien con el menu cerrado. */}
              <span className="text-[12px] font-semibold text-neutral-800">
                Rol: <span className="font-extrabold">{NOMBRE_ROL[sesion.rol]}</span>
              </span>
              <button
                type="button"
                aria-expanded={menuAbierto}
                aria-controls="menu-panel"
                onClick={() => setMenuAbierto((v) => !v)}
                className="grid size-10 cursor-pointer place-items-center rounded-full text-text hover:bg-accent-200"
              >
                <Icon name={menuAbierto ? 'close' : 'menu'} size={22} />
                <span className="sr-only">{menuAbierto ? 'Cerrar menú' : 'Abrir menú'}</span>
              </button>
            </div>
          </div>
          <div id="menu-panel" className={`${menuAbierto ? 'flex' : 'hidden'} flex-1 flex-col gap-[26px] md:flex`}>
            <nav aria-label="Menú principal" className="flex flex-col gap-[26px]">
              {GRUPOS.map(({ id, titulo }) => {
                const delGrupo = items.filter((i) => i.grupo === id);
                if (delGrupo.length === 0) return null;
                return (
                  <div key={id} className="flex flex-col gap-[3px]">
                    {titulo && <span className="px-2 pb-1.5 text-[11px] font-extrabold tracking-[0.14em] text-neutral-700 uppercase">{titulo}</span>}
                    {delGrupo.map((i) => (
                      <Enlace key={i.href} item={i} activo={activo(i.href)} />
                    ))}
                  </div>
                );
              })}
            </nav>
            {modulos.error && <p className="m-0 px-2 text-xs font-semibold text-neutral-700">No pudimos cargar los módulos del centro.</p>}

            <div className="mt-auto flex flex-col gap-4">
              {esAdministracion(sesion.rol) && <SelectorEquipo />}
              <SelectorRol rol={sesion.rol} roles={sesion.roles} />
              <div className="flex items-center gap-2.5 border-t border-divider px-2.5 pt-2.5">
                <Avatar name={nombre || NOMBRE_ROL[sesion.rol]} />
                <div className="min-w-0 flex-1">
                  {nombre ? (
                    <div className="truncate text-[13px] font-extrabold tracking-[-0.01em]">{nombre}</div>
                  ) : (
                    <div aria-hidden="true" className="esqueleto my-0.5 h-3.5 w-28 rounded-full" />
                  )}
                  <div className="text-[12px] font-semibold text-neutral-700">{NOMBRE_ROL[sesion.rol]}</div>
                </div>
                <BotonSalir />
              </div>
            </div>
          </div>
        </aside>
        <main key={ruta} className="entrada min-w-0 px-[clamp(24px,3.4vw,48px)] pt-[30px] pb-14">
          {children}
        </main>
      </div>
    </ProveedorEquipoActivo>
  );
}
