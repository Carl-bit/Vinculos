'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Field, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { useCentroPublico, useMiCuenta, useModulos } from '@/lib/consultas';
import { menuVisible } from '@/lib/navegacion';
import { NOMBRE_ROL } from '@/lib/roles';
import type { SesionActiva } from '@/lib/sesion';
import { BotonSalir } from './BotonSalir';
import { ProveedorPortal, usePortal } from './ContextoPortal';
import { CargaModulo } from './CargaModulo';
import { Marca } from './Marca';
import { MarcaZona } from './MarcaZona';

/** Shell del portal del paciente (diseño "Paciente - Mi Cuenta"): header, menor a cargo y secciones de la cuenta. */
export function LayoutPortal({ sesion, children }: { sesion: SesionActiva; children: ReactNode }) {
  return (
    <ProveedorPortal key={sesion.rol} rol={sesion.rol}>
      <Shell sesion={sesion}>{children}</Shell>
    </ProveedorPortal>
  );
}

function Shell({ sesion, children }: { sesion: SesionActiva; children: ReactNode }) {
  const ruta = usePathname();
  const modulos = useModulos();
  const cuenta = useMiCuenta();
  const centro = useCentroPublico().data;
  const portal = usePortal();
  const activos = modulos.data?.activos ?? [];
  // Mientras no se sabe si la cuenta es restringida (adolescente), no se muestran sus secciones vedadas.
  const items = menuVisible('portal', sesion.rol, activos, { restringida: portal.restringida || portal.cargando });
  const header = items.filter((i) => i.grupo === 'principal' && i.href !== '/portal');
  const secciones = items.filter((i) => i.grupo === 'secciones');
  const nombre = cuenta.data?.nombre ?? NOMBRE_ROL[sesion.rol];
  const activo = (href: string) => (href === '/portal' ? ruta === href : ruta.startsWith(href));

  return (
    <>
      <MarcaZona zona="portal" principal={centro?.color_portal} fondo={centro?.color_fondo_portal} />
      {/* 03c: el portal va sobre el lienzo con puntos (como el panel); las tarjetas quedan en crema. */}
      <div className="trama min-h-screen overflow-x-clip">
        <div className="mx-auto max-w-[1120px] px-[clamp(20px,4vw,40px)] pb-[72px]">
          <header className="flex flex-wrap items-center gap-x-5 gap-y-3 py-[22px]">
            <Marca href="/portal" />
            <nav aria-label="Menú del portal" className="ml-auto flex flex-wrap gap-x-[26px] gap-y-1 text-[14.5px] font-bold">
              {header.map((i) => (
                <Link key={i.href} href={i.href} className="flex min-h-10 items-center text-text hover:text-accent-2-700">
                  {i.etiqueta}
                </Link>
              ))}
              {activos.includes('PAGINA_PUBLICA') && (
                <Link href="/equipo" className="flex min-h-10 items-center text-text hover:text-accent-2-700">
                  Equipo
                </Link>
              )}
            </nav>
            <span className="flex items-center gap-[9px] rounded-full border-[1.5px] border-neutral-400 py-1 pr-1 pl-[7px]">
              <Avatar name={nombre} tone="patient" size={26} />
              <span className="text-[13.5px] font-extrabold">{nombre}</span>
              <span className="sr-only">({NOMBRE_ROL[sesion.rol]})</span>
              <BotonSalir className="!size-8" />
            </span>
          </header>

          {portal.responsable && portal.pacientes.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2 rounded-lg border border-accent-2-500 bg-accent-2-100 px-5 py-4">
              <div className="min-w-[220px] flex-1">
                <Field label="Estás viendo la cuenta de">
                  {(p) => (
                    <Select {...p} value={portal.pacienteId ?? ''} onChange={(e) => portal.elegirPaciente(e.target.value)} className="!py-2.5 text-[14px]">
                      {portal.pacientes.map((pa) => (
                        <option key={pa.id} value={pa.id}>
                          {pa.nombre} {pa.apellido}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <p className="m-0 mb-1 flex max-w-md gap-2 text-[12.5px] font-semibold text-accent-2-900">
                <Icon name="family_restroom" size={18} className="text-accent-2-700" />
                Como adulto responsable ves sus horas, pagos y documentos. Los mensajes que tu menor le escribe a su profesional son privados.
              </p>
            </div>
          )}

          {secciones.length > 1 && (
            // 03c Moderno A: barra flotante (pastilla translucida) fija arriba desde tablet; en telefono se desplaza en una linea.
            <nav
              aria-label="Secciones de mi cuenta"
              className="translucida z-20 mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-borde p-1.5 text-tinta shadow-flotante [scrollbar-width:thin] md:sticky md:top-3"
            >
              {secciones.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={activo(i.href) ? 'page' : undefined}
                  className={`flex min-h-11 flex-none items-center gap-2 rounded-full px-4 text-[13px] font-extrabold whitespace-nowrap transition-colors duration-200 ease-out ${
                    activo(i.href) ? 'bg-accent-2-700 text-neutral-100 shadow-md hover:text-neutral-100' : 'text-tinta hover:bg-lienzo hover:text-tinta'
                  }`}
                >
                  <Icon name={i.icono} size={17} />
                  {i.etiqueta}
                </Link>
              ))}
            </nav>
          )}

          <main id="contenido" tabIndex={-1} className="entrada outline-none" key={ruta}>
            <CargaModulo>{children}</CargaModulo>
          </main>
        </div>
      </div>
    </>
  );
}
