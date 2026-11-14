import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SONDEO_MS, useEstadoReserva, type EstadoReserva } from './reserva';

const consultar = vi.fn<() => Promise<EstadoReserva>>();
vi.mock('./api/cliente', () => ({
  api: { POST: () => consultar() },
  datos: (p: Promise<EstadoReserva>) => p,
}));

const estado = (e: EstadoReserva['estado']) =>
  ({ estado: e, venceEn: null, siguiente: e === 'RETENIDA' ? 'VERIFICAR_CORREO' : 'NINGUNO' }) as unknown as EstadoReserva;

function Sondeo({ reserva }: { reserva: string }) {
  useEstadoReserva(reserva);
  return null;
}

const montar = (reserva: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Sondeo reserva={reserva} />
    </QueryClientProvider>,
  );

const pasa = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useEstadoReserva (sondeo de la reserva)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    consultar.mockReset();
  });
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it('consulta cada pocos segundos mientras la reserva espera y se detiene al llegar a un estado final', async () => {
    const respuestas = [estado('RETENIDA'), estado('SOLICITADA'), estado('CONFIRMADA')];
    consultar.mockImplementation(async () => respuestas.shift() ?? estado('CONFIRMADA'));
    montar('a');
    await pasa(0);
    expect(consultar).toHaveBeenCalledTimes(1);
    await pasa(SONDEO_MS);
    await pasa(SONDEO_MS);
    expect(consultar).toHaveBeenCalledTimes(3);
    await pasa(SONDEO_MS * 5);
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it('no consulta con la pestaña oculta y retoma al volver', async () => {
    consultar.mockImplementation(async () => estado('RETENIDA'));
    montar('b');
    await pasa(0);
    expect(consultar).toHaveBeenCalledTimes(1);
    act(() => focusManager.setFocused(false));
    await pasa(SONDEO_MS * 4);
    expect(consultar).toHaveBeenCalledTimes(1);
    act(() => focusManager.setFocused(true));
    await pasa(SONDEO_MS);
    expect(consultar.mock.calls.length).toBeGreaterThan(1);
  });
});
