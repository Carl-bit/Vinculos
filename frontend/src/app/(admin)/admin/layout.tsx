'use client';

import { GuardaZona } from '@/components/shared/GuardaZona';
import { ContratoPendiente } from '@/components/nucleo/ContratoCentro';
import { LayoutAdmin } from '@/components/shared/LayoutAdmin';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <GuardaZona zona="admin">{(sesion) => (
        <LayoutAdmin sesion={sesion}>
          {children}
          <ContratoPendiente esAdmin={sesion.rol === 'ADMIN'} />
        </LayoutAdmin>
      )}</GuardaZona>;
}
