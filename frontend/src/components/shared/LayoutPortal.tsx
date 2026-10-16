'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { menuVisible } from '@/lib/navegacion';
import { NOMBRE_ROL } from '@/lib/roles';
import type { SesionActiva } from '@/lib/sesion';
import { BotonSalir } from './BotonSalir';
import { Marca } from './Marca';

/** Shell del portal del paciente (diseño "Paciente - Mi Cuenta"). */
export function LayoutPortal({ sesion, children }: { sesion: SesionActiva; children: ReactNode }) {
  const modulos = useModulos();
  const cuenta = useMiCuenta();
  const items = menuVisible('portal', sesion.rol, modulos.data?.activos ?? []).filter((i) => i.href !== '/portal');
  const nombre = cuenta.data?.nombre ?? NOMBRE_ROL[sesion.rol];

  return (
    <div className="mx-auto max-w-[1120px] px-[clamp(20px,4vw,40px)] pb-[72px]">
      <header className="flex flex-wrap items-center gap-5 py-[22px]">
        <Marca href="/portal" />
        <nav aria-label="Menú del portal" className="ml-auto flex gap-[26px] text-[14.5px] font-bold">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="text-text hover:text-accent-2-700">
              {i.etiqueta}
            </Link>
          ))}
        </nav>
        <span className="flex items-center gap-[9px] rounded-full border-[1.5px] border-neutral-400 py-1 pr-1 pl-[7px]">
          <Avatar name={nombre} tone="patient" size={26} />
          <span className="text-[13.5px] font-extrabold">{nombre}</span>
          <span className="sr-only">({NOMBRE_ROL[sesion.rol]})</span>
          <BotonSalir className="!size-8" />
        </span>
      </header>
      <main className="entrada">{children}</main>
    </div>
  );
}
