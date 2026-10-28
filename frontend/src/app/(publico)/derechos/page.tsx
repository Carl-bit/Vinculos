import type { Metadata } from 'next';

import { FormularioDerechos } from '@/components/nucleo/FormularioDerechos';

/** AUD-01 (E2.3b): derechos sobre los datos personales sin cuenta (Ley 21.719). */
export const metadata: Metadata = { title: 'Derechos sobre tus datos', robots: { index: false, follow: false } };

export default function Pagina() {
  return (
    <div className="flex justify-center py-[clamp(16px,3vw,40px)]">
      <FormularioDerechos />
    </div>
  );
}
