import { notFound } from 'next/navigation';

import { MuestrarioEstilo } from '@/components/shared/MuestrarioEstilo';

export const metadata = { title: 'Estilo Moderno A', robots: { index: false } };

/** Muestrario del sistema (03c fase 1). Solo en desarrollo. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <MuestrarioEstilo />;
}
