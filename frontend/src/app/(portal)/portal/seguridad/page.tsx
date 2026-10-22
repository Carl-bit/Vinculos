import type { Metadata } from 'next';

import { CambioPassword } from '@/components/shared/CambioPassword';
import { Encabezado } from '@/components/shared/Encabezado';
import { SegundoFactorCuenta } from '@/components/shared/SegundoFactorCuenta';

export const metadata: Metadata = { title: 'Seguridad' };

export default function Pagina() {
  return (
    <>
      <Encabezado titulo="Seguridad" bajada="Tu contraseña es personal. Si olvidas cerrar la sesión, se cierra sola tras 30 minutos sin actividad." />
      <div className="flex flex-col gap-6">
        <CambioPassword />
        <SegundoFactorCuenta />
      </div>
    </>
  );
}
