import { redirect } from 'next/navigation';

/**
 * 03b-4.2: la ficha clinica vive en las pestañas de la vista del paciente.
 * Los enlaces antiguos (`/ficha?vista=&cita=&borrador=`) llegan a la misma
 * seccion sin el paso intermedio.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') q.set(k, v);
  if (!q.has('vista')) q.set('vista', 'evoluciones');
  redirect(`/admin/fichas/${id}?${q.toString()}`);
}
