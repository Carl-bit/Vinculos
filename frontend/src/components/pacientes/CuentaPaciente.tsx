'use client';

import { useEffect, useRef, useState } from 'react';

import { BotonSalir } from '@/components/shared/BotonSalir';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { useMiCuenta } from '@/lib/consultas';

import { MisDatos } from './MisDatos';

/**
 * Punto 42 (correcciones 2026-11-10/11): tarjeta propia a la altura de la
 * barra de secciones. Al tocarla despliega los datos (solo lectura),
 * "Modificar mis datos" (los cambios se hacen en Seguridad) y "Salir".
 */
export function CuentaPaciente() {
  const cuenta = useMiCuenta();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);
  const nombre = cuenta.data?.nombre ?? 'Mi cuenta';
  return (
    <div ref={caja} className="translucida relative rounded-full border border-borde p-1.5 shadow-flotante">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="menu-cuenta-paciente"
        onClick={() => setAbierto((a) => !a)}
        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-full py-1 pr-4 pl-1 text-[15.5px] font-extrabold text-tinta transition-colors duration-200 ease-out ${
          abierto ? 'bg-accent-2-200' : 'hover:bg-lienzo'
        }`}
      >
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-accent-2-700 text-[14px] font-black text-neutral-100">
          {nombre
            .split(' ')
            .slice(0, 2)
            .map((p) => p[0])
            .join('')}
        </span>
        <span className="max-w-[220px] truncate">{nombre}</span>
        <Icon name={abierto ? 'expand_less' : 'expand_more'} size={20} />
      </button>
      {abierto && (
        <div
          id="menu-cuenta-paciente"
          className="absolute top-full right-0 z-30 mt-2 flex w-[min(380px,calc(100vw-32px))] flex-col gap-3 rounded-lg border border-divider bg-surface p-3 shadow-lg motion-safe:animate-[aparecer_160ms_ease-out]"
        >
          <MisDatos lectura />
          <ButtonLink href="/portal/seguridad?seccion=datos" variant="outlinePatient" icon="edit" className="w-full">
            Modificar mis datos
          </ButtonLink>
          <BotonSalir grande />
        </div>
      )}
    </div>
  );
}
