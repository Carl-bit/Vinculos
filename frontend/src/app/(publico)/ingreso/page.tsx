import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FormularioIngreso } from '@/components/shared/FormularioIngreso';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function Ingreso() {
  return (
    <div className="flex justify-center py-[clamp(16px,3vw,40px)]">
      <Suspense>
        <FormularioIngreso />
      </Suspense>
    </div>
  );
}
