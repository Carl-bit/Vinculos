import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AsistenteMatch } from '@/components/match/AsistenteMatch';
import { centroPublico, cuestionario } from '@/lib/api/servidor';

export const metadata: Metadata = {
  title: 'Match terapéutico',
  description: 'Responde unas preguntas y te sugerimos un profesional del centro. No guardamos tus respuestas.',
};

export default async function Match() {
  const [centro, q] = await Promise.all([centroPublico(), cuestionario()]);
  if (!centro?.modulos.includes('MATCH') || !q || q.preguntas.length === 0) notFound();
  return <AsistenteMatch preguntas={q.preguntas} agenda={centro.modulos.includes('AGENDA')} filtroDirecto={q.filtroDirecto} />;
}
