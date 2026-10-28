import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DocumentoPolitica } from '@/components/shared/DocumentoPolitica';
import { politica, type TipoPolitica } from '@/lib/api/servidor';

/** El protocolo interno del equipo y el contrato con Vinculos (AUD-01) no son publicos (la API responde 404). */
type TipoPublico = Exclude<TipoPolitica, 'PROTOCOLO_EQUIPO' | 'TERMINOS_SERVICIO' | 'DPA'>;

const TITULOS: Record<TipoPublico, string> = {
  POLITICA_DATOS: 'Política de datos personales',
  TERMINOS_AGENDAMIENTO: 'Términos de agendamiento y cancelación',
  CONSENTIMIENTO_ATENCION: 'Consentimiento informado de atención',
  CONSENTIMIENTO_PRACTICANTE: 'Consentimiento de atención con practicante supervisado',
  PROTOCOLO_PACIENTE: 'Protocolo de atención para pacientes',
};

const esTipo = (t: string): t is TipoPublico => t in TITULOS;

export async function generateMetadata({ params }: { params: Promise<{ tipo: string }> }): Promise<Metadata> {
  const { tipo } = await params;
  return { title: esTipo(tipo) ? TITULOS[tipo] : 'Documento' };
}

/** Politica vigente (enlace desde la casilla de Pedir hora y el pie del sitio). */
export default async function Politica({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  if (!esTipo(tipo)) notFound();
  const p = await politica(tipo);
  if (!p) notFound();
  return <DocumentoPolitica titulo={TITULOS[tipo]} version={p.version} vigenteDesde={p.vigente_desde} texto={p.texto} />;
}
