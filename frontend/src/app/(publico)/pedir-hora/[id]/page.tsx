import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SolicitudHora } from '@/components/agenda/SolicitudHora';
import { EstadoVista } from '@/components/shared/EstadoVista';
import { centroPublico, perfilPublico, politica } from '@/lib/api/servidor';
import { nombrePerfil } from '@/lib/perfiles';

const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = UUID.test(id) ? await perfilPublico(id) : null;
  return { title: p ? `Pedir hora con ${nombrePerfil(p)}` : 'Pedir una hora', robots: { index: false } };
}

export default async function PedirHoraCon({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [centro, perfil, datos, terminos] = await Promise.all([
    centroPublico(),
    perfilPublico(id),
    politica('POLITICA_DATOS'),
    politica('TERMINOS_AGENDAMIENTO'),
  ]);
  if (!centro?.modulos.includes('AGENDA') || !perfil) notFound();
  if (!datos) {
    return (
      <EstadoVista
        estado="vacio"
        titulo="La reserva en línea aún no está disponible"
        mensaje="El centro todavía no publica su política de datos personales. Escríbenos para coordinar una hora."
      />
    );
  }
  return (
    <SolicitudHora
      perfil={perfil}
      centro={centro}
      politicaDatos={{ id: datos.id, version: datos.version }}
      terminos={terminos && { id: terminos.id, version: terminos.version }}
    />
  );
}
