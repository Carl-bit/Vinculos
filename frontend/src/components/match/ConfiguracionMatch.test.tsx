import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfiguracionMatch } from './ConfiguracionMatch';

const PATCH = vi.hoisted(() => vi.fn());
const pregunta = (id: string, orden: number) => ({
  id,
  clave: id,
  texto: `Pregunta ${id}`,
  tipo: 'TEXTO',
  orden,
  activa: true,
  obligatoria: false,
  propiaCentro: false,
  ayuda: null,
  opciones: [],
});
const consulta = (data: unknown) => ({ data, isSuccess: true, isPending: false, isError: false, error: null, refetch: vi.fn() });

vi.mock('@/lib/api/cliente', () => ({
  api: { GET: (ruta: string) => (ruta === '/api/match/preguntas' ? [pregunta('a', 1), pregunta('b', 2), pregunta('c', 3)] : { ranking: [] }), PATCH },
  datos: async (r: unknown) => r,
}));
vi.mock('@/lib/centro', () => ({ useConfiguracionCentro: () => consulta({ matchFiltroDirecto: false, diasRetencionRespuestasMatch: 30 }) }));
vi.mock('@/lib/consultas', () => ({ useModulos: () => consulta({ activos: ['AGENDA', 'EQUIPO'] }) }));

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfiguracionMatch />
    </QueryClientProvider>,
  );
const asa = (id: string) => screen.findByRole('button', { name: new RegExp(`Mover «Pregunta ${id}»`) });

describe('Orden de las preguntas del match', () => {
  beforeEach(() => {
    PATCH.mockReset();
    PATCH.mockResolvedValue({});
  });

  it('cada pregunta muestra un asa y con las flechas guarda solo las que cambiaron', async () => {
    montar();
    fireEvent.keyDown(await asa('a'), { key: 'ArrowDown' });
    await waitFor(() => expect(PATCH).toHaveBeenCalledTimes(2));
    expect(PATCH).toHaveBeenCalledWith('/api/match/preguntas/{id}', { params: { path: { id: 'b' } }, body: { orden: 1 } });
    expect(PATCH).toHaveBeenCalledWith('/api/match/preguntas/{id}', { params: { path: { id: 'a' } }, body: { orden: 2 } });
  });

  it('con una pregunta abierta ninguna se mueve', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /Pregunta c/, expanded: false }));
    expect(screen.getByText('Cierra las preguntas abiertas para poder moverlas.')).toBeInTheDocument();
    const a = await asa('a');
    expect(a).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(PATCH).not.toHaveBeenCalled();
  });
});
