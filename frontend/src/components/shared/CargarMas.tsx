'use client';

import { Button } from '@/components/ui/Button';

/** Pie de una lista paginada por cursor (AUD-02 API-01): pide la pagina siguiente mientras haya. */
export function CargarMas({ consulta }: { consulta: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => Promise<unknown> } }) {
  if (!consulta.hasNextPage) return null;
  return (
    <div className="flex justify-center">
      <Button variant="secondary" icon="expand_more" disabled={consulta.isFetchingNextPage} onClick={() => void consulta.fetchNextPage()}>
        {consulta.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
      </Button>
    </div>
  );
}
