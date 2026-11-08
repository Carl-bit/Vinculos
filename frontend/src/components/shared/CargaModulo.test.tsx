import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CargaModulo } from './CargaModulo';

function Panel({ clave, ms }: { clave: string; ms: number }) {
  const { data } = useQuery({ queryKey: [clave], queryFn: () => new Promise<string>((ok) => setTimeout(() => ok(clave), ms)) });
  return <p>{data ?? `cargando ${clave}`}</p>;
}

describe('CargaModulo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('muestra el esqueleto hasta que todos los paneles tienen datos y luego todo junto', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CargaModulo>
          <Panel clave="rapido" ms={100} />
          <Panel clave="lento" ms={900} />
        </CargaModulo>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');

    await act(() => vi.advanceTimersByTimeAsync(400)); // el rapido ya llego: sigue el esqueleto
    expect(screen.getByRole('status')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(800)); // llego el lento + asentado
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('rapido')).toBeVisible();
    expect(screen.getByText('lento')).toBeVisible();
  });
});
