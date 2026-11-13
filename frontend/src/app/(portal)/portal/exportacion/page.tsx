'use client';

import { Suspense } from 'react';

import { DescargaExportacion } from '@/components/nucleo/DescargaExportacion';

/** AUD-01 Fase 3: copia de datos de un paciente con cuenta (el portal exige su sesion). */
export default function Pagina() {
  return (
    <div className="flex justify-center">
      <Suspense>
        <DescargaExportacion />
      </Suspense>
    </div>
  );
}
