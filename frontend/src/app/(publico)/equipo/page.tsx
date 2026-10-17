import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EquipoPublico } from '@/components/equipo/EquipoPublico';
import { centroPublico, perfilesPublicos } from '@/lib/api/servidor';

export const metadata: Metadata = {
  title: 'Equipo',
  description: 'Conoce al equipo del centro: formación verificada, enfoque, tarifas y valoraciones de pacientes atendidos.',
};

export default async function Equipo({ searchParams }: { searchParams: Promise<{ atencion?: string }> }) {
  const [{ atencion }, centro, perfiles] = await Promise.all([searchParams, centroPublico(), perfilesPublicos()]);
  if (!centro?.modulos.includes('PAGINA_PUBLICA')) notFound();
  return <EquipoPublico perfiles={perfiles} atencion={atencion} agenda={centro.modulos.includes('AGENDA')} match={centro.modulos.includes('MATCH')} />;
}
