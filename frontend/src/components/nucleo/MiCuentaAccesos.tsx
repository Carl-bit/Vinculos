'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { CambioPassword } from '@/components/shared/CambioPassword';
import { SegundoFactorCuenta } from '@/components/shared/SegundoFactorCuenta';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import type { Icono } from '@/lib/iconos';

import { MiCuentaEquipo } from './MiCuentaEquipo';

const FILA =
  'flex w-full min-h-[60px] items-center gap-3.5 rounded-[18px] border border-divider bg-bg px-4 py-3 text-left text-text transition-shadow duration-200 hover:text-text hover:shadow-md';

function Texto({ icono, titulo, nota }: { icono: Icono; titulo: string; nota: string }) {
  return (
    <>
      <Icon name={icono} size={20} className="text-neutral-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-black tracking-[-0.01em]">{titulo}</span>
        <span className="block text-[12.5px] font-semibold text-neutral-700">{nota}</span>
      </span>
    </>
  );
}

/** Fila que se despliega en el lugar (details nativo: teclado y lector sin ARIA extra). */
function Desplegable({ icono, titulo, nota, children }: { icono: Icono; titulo: string; nota: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className={`${FILA} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <Texto icono={icono} titulo={titulo} nota={nota} />
        <Icon name="expand_more" className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="px-2 pt-1 pb-3">{children}</div>
    </details>
  );
}

/**
 * "Mi cuenta" (diseño "Admin - Mi Perfil"): datos de contacto, contraseña,
 * verificacion en dos pasos, avisos y, si cobra, liquidaciones. Cada fila se
 * despliega o lleva a su seccion.
 */
export function MiCuentaAccesos({ liquidaciones }: { liquidaciones: boolean }) {
  return (
    <Panel titulo="Mi cuenta">
      <div className="mt-4 flex flex-col gap-2.5">
        <Desplegable icono="badge" titulo="Mis datos de contacto" nota="Nombre, correo de ingreso y teléfono">
          <MiCuentaEquipo enPanel={false} />
        </Desplegable>
        <Desplegable icono="key" titulo="Cambiar mi contraseña" nota="Te pediremos la actual">
          <CambioPassword tono="team" enPanel={false} />
        </Desplegable>
        <Desplegable icono="verified_user" titulo="Verificación en dos pasos" nota="Código por correo en cada ingreso · códigos de respaldo">
          <SegundoFactorCuenta tono="team" enPanel={false} />
        </Desplegable>
        <Link href="/admin/mensajes" className={FILA}>
          <Texto icono="notifications" titulo="Avisos y recordatorios" nota="Bandeja de avisos del centro y mensajes" />
          <Icon name="arrow_forward" />
        </Link>
        {liquidaciones && (
          <Link href="/admin/cobros" className={FILA}>
            <Texto icono="receipt_long" titulo="Mis liquidaciones" nota="Sesiones realizadas, cobros y pagos del período" />
            <Icon name="arrow_forward" />
          </Link>
        )}
      </div>
    </Panel>
  );
}
