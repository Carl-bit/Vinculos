import Link from 'next/link';
import type { ReactNode } from 'react';

import { Marca, NOMBRE_CENTRO } from './Marca';

/**
 * Shell del sitio publico del centro (diseño "Landing"). Server component.
 * La navegacion (Equipo, Servicios, Match, Contacto) entra con las paginas
 * publicas y segun los modulos activos de publico/centro.
 */
export function LayoutPublico({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1180px] px-[clamp(20px,4vw,40px)]">
      <header className="flex items-center gap-5 py-[22px]">
        <Marca />
        <Link
          href="/ingreso"
          className="ml-auto rounded-full bg-accent-2-700 px-[22px] py-[11px] text-sm font-extrabold text-neutral-100 hover:bg-accent-2-800 hover:text-neutral-100"
        >
          Iniciar sesión
        </Link>
      </header>
      <main>{children}</main>
      <footer className="flex flex-wrap items-center gap-[22px] py-[30px] text-[13px] font-semibold text-neutral-700">
        <span>
          © {new Date().getFullYear()} {NOMBRE_CENTRO}
        </span>
        <span className="ml-auto flex items-center gap-[7px]">
          Plataforma <span className="font-black text-neutral-700">Vínculos</span>
        </span>
      </footer>
    </div>
  );
}
