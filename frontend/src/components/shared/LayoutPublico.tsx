import { Suspense } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { centroPublico } from '@/lib/api/servidor';

import { AccesoCuenta } from './AccesoCuenta';
import { Marca, NOMBRE_CENTRO } from './Marca';
import { MarcaZona } from './MarcaZona';
import { NavPublica } from './NavPublica';

/**
 * Shell del sitio publico del centro (diseño "Landing", estilo Moderno de
 * design-reference/Landing: trama de puntos y barra pildora). Server component: el
 * nombre del centro y la navegacion salen de publico/centro (los modulos
 * inactivos no aparecen). Si la API no responde, queda la marca y el acceso.
 */
export async function LayoutPublico({ children }: { children: ReactNode }) {
  const centro = await centroPublico().catch(() => null);
  const modulos = centro?.modulos ?? [];
  const nombre = centro?.nombre_centro ?? NOMBRE_CENTRO;
  const nav = [
    modulos.includes('PAGINA_PUBLICA') && { href: '/equipo', etiqueta: 'Equipo' },
    centro && { href: '/#servicios', etiqueta: 'Servicios' },
    modulos.includes('MATCH') && { href: '/match', etiqueta: 'Match terapéutico' },
    modulos.includes('AGENDA') && { href: '/pedir-hora', etiqueta: 'Pedir una hora' },
  ].filter((x): x is { href: string; etiqueta: string } => !!x);

  return (
    <div className="trama min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1228px] flex-col px-[clamp(16px,3vw,24px)]">
        <MarcaZona zona="publico" principal={centro?.color_marca} fondo={centro?.color_fondo_publico} />
        {/* Barra flotante del diseño "Moderno": pildora translucida y fija arriba al hacer scroll. */}
        <header className="barra-publica translucida sticky top-3 z-20 mt-[18px] flex flex-wrap items-center gap-2 rounded-[28px] border border-borde py-2 pr-2 pl-5 shadow-suave md:rounded-full">
          <Marca nombre={nombre} />
          <NavPublica enlaces={nav} />
          {/* useSearchParams (alternar perfil en el login) exige Suspense en paginas estaticas. */}
          <Suspense>
            <AccesoCuenta />
          </Suspense>
        </header>
        <main id="contenido" tabIndex={-1} className="flex-1 pt-[clamp(12px,2vw,28px)] outline-none">
          {children}
        </main>
        <footer className="mt-10 flex flex-wrap items-center gap-x-[22px] gap-y-2 border-t border-borde pt-4 pb-[30px] text-[13px] font-semibold text-neutral-700">
          <span>
            © {new Date().getFullYear()} {nombre}
          </span>
          <Link href="/politicas/POLITICA_DATOS" className="text-neutral-700 hover:text-accent-2-800">
            Privacidad
          </Link>
          <Link href="/derechos" className="text-neutral-700 hover:text-accent-2-800">
            Derechos sobre tus datos
          </Link>
          {centro?.instagram && (
            <a
              href={`https://instagram.com/${centro.instagram.replace(/^@/, '')}`}
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-neutral-700 hover:text-accent-2-800"
            >
              Instagram <Icon name="north_east" size={14} />
            </a>
          )}
          <span className="ml-auto flex items-center gap-[7px]">
            Plataforma <span className="font-black">Vínculos</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
