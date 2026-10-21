import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SONDEO_MS, useEstadoPago, type CaminoPago, type EstadoConfirmacion } from './pagos';

const estado = (e: EstadoConfirmacion['estado']): EstadoConfirmacion => ({
  estado: e,
  venceEn: null,
  siguiente: e === 'RETENIDA' ? 'VERIFICAR_CORREO' : 'NINGUNO',
  medios: null,
  medio: null,
  monto: null,
  comprobanteRecibido: false,
  motivoRechazo: null,
  pasarelaSimulada: true,
});

function Sondeo({ camino }: { camino: CaminoPago }) {
  useEstadoPago(camino);
  return null;
}

const montar = (camino: CaminoPago) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Sondeo camino={camino} />
    </QueryClientProvider>,
  );

const pasa = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useEstadoPago (sondeo de la reserva)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
  });
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it('consulta cada pocos segundos mientras la reserva esta retenida y se detiene al llegar a un estado final', async () => {
    const respuestas = [estado('RETENIDA'), estado('RETENIDA'), estado('CONFIRMADA')];
    const consultar = vi.fn(async () => respuestas.shift() ?? estado('CONFIRMADA'));
    montar({ clave: ['a'], estado: consultar } as unknown as CaminoPago);
    await pasa(0);
    expect(consultar).toHaveBeenCalledTimes(1);
    await pasa(SONDEO_MS);
    await pasa(SONDEO_MS);
    expect(consultar).toHaveBeenCalledTimes(3);
    await pasa(SONDEO_MS * 5);
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it('no consulta con la pestaña oculta y retoma al volver', async () => {
    const consultar = vi.fn(async () => estado('RETENIDA'));
    montar({ clave: ['b'], estado: consultar } as unknown as CaminoPago);
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
