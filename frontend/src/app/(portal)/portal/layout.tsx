'use client';

import { GuardaZona } from '@/components/shared/GuardaZona';
import { LayoutPortal } from '@/components/shared/LayoutPortal';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <GuardaZona zona="portal">{(sesion) => <LayoutPortal sesion={sesion}>{children}</LayoutPortal>}</GuardaZona>;
}
