'use client';

import { GuardaZona } from '@/components/shared/GuardaZona';
import { LayoutAdmin } from '@/components/shared/LayoutAdmin';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <GuardaZona zona="admin">{(sesion) => <LayoutAdmin sesion={sesion}>{children}</LayoutAdmin>}</GuardaZona>;
}
