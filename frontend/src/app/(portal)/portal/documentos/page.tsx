import type { Metadata } from 'next';

import { CopiaFicha, DocumentosPortal } from '@/components/pacientes/DocumentosPortal';
import { Encabezado } from '@/components/shared/Encabezado';
import { SoloCuentaPlena } from '@/components/shared/SoloCuentaPlena';

export const metadata: Metadata = { title: 'Documentos' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Documentos" bajada="Certificados e informes emitidos por tu profesional, y la copia de tu ficha clínica." />
      <SoloCuentaPlena>
        <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
          <DocumentosPortal />
          <CopiaFicha />
        </div>
      </SoloCuentaPlena>
    </>
  );
}
