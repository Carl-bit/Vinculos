import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PaginaPerfil } from '@/components/equipo/EquipoPublico';
import { centroPublico, perfilPublico, resenasPublicas } from '@/lib/api/servidor';
import { nombrePerfil } from '@/lib/perfiles';

const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = UUID.test(id) ? await perfilPublico(id) : null;
  if (!p) return { title: 'Perfil no encontrado' };
  const descripcion = `${p.especialidad}. ${p.cita_destacada ?? p.bio ?? ''}`.trim().slice(0, 160);
  return {
    title: nombrePerfil(p),
    description: descripcion,
    openGraph: { title: nombrePerfil(p), description: descripcion, type: 'profile', images: p.foto_url ? [p.foto_url] : undefined },
  };
}

export default async function Perfil({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [centro, perfil, resenas] = await Promise.all([centroPublico(), perfilPublico(id), resenasPublicas(id)]);
  if (!perfil || !centro) notFound();
  return <PaginaPerfil perfil={perfil} resenas={resenas} agenda={centro.modulos.includes('AGENDA')} />;
}
