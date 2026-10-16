'use client';

import { Eyebrow } from '@/components/ui/Eyebrow';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFechaLarga } from '@/lib/formato';

/** Encabezado de inicio: fecha de hoy (America/Santiago) y saludo con el nombre. */
export function Bienvenida({ tone }: { tone: 'team' | 'patient' }) {
  const cuenta = useMiCuenta();
  const nombre = cuenta.data?.nombre?.split(' ')[0];
  const fecha = formatoFechaLarga(new Date());
  return (
    <div className="mb-[30px]">
      <Eyebrow tone={tone}>{fecha.charAt(0).toUpperCase() + fecha.slice(1)}</Eyebrow>
      <h1 className="m-0 flex items-center gap-3 text-[34px] leading-[1.05] font-black tracking-[-0.03em]">
        {nombre ? `Hola, ${nombre}` : 'Hola'}
        {cuenta.isPending && <span aria-hidden="true" className="esqueleto h-7 w-36 rounded-full" />}
      </h1>
    </div>
  );
}
