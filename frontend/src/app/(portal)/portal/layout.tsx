'use client';

import { CuentaPaciente } from '@/components/pacientes/CuentaPaciente';
import { GuardaZona } from '@/components/shared/GuardaZona';
import { LayoutPortal } from '@/components/shared/LayoutPortal';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <GuardaZona zona="portal">
      {(sesion) => (
        <LayoutPortal sesion={sesion} cuenta={<CuentaPaciente />}>
          {children}
        </LayoutPortal>
      )}
    </GuardaZona>
  );
}
