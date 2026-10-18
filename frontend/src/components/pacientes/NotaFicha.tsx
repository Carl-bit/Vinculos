'use client';

import Link from 'next/link';

import { usePortal } from '@/components/shared/ContextoPortal';
import { Aviso } from '@/components/ui/Aviso';

/** Nota del diseño: la ficha clinica no se ve en el portal; la copia (epicrisis) se pide (Ley 20.584). */
export function NotaFicha() {
  const portal = usePortal();
  return (
    <Aviso tono="nota" className="!rounded-lg !px-[26px] !py-6">
      <span className="text-[13.5px] leading-relaxed text-neutral-700">
        Las notas de las sesiones son parte de la ficha clínica y solo el profesional tratante puede verlas.{' '}
        {portal.restringida ? (
          'Si necesitas una copia, pídela con tu adulto responsable.'
        ) : (
          <>
            Si necesitas una copia, <Link href="/portal/documentos#copia">pídela desde Documentos</Link>: el centro la prepara y te avisa.
          </>
        )}
      </span>
    </Aviso>
  );
}
