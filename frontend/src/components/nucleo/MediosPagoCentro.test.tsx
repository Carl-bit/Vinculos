import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediosPagoCentro } from './MediosPagoCentro';

const PATCH = vi.hoisted(() => vi.fn());
const PUT = vi.hoisted(() => vi.fn());
let cuenta: unknown = null;
let centro: Record<string, unknown>;
const consulta = <T,>(data: T) => ({ data, isSuccess: true, isPending: false, isError: false, error: null, refetch: vi.fn() });

vi.mock('@/lib/api/cliente', () => ({ api: { GET: () => cuenta, PATCH, PUT }, datos: async (r: unknown) => r }));
vi.mock('@/lib/centro', () => ({ useConfiguracionCentro: () => consulta(centro) }));

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MediosPagoCentro />
    </QueryClientProvider>,
  );

describe('MediosPagoCentro', () => {
  beforeEach(() => {
    PATCH.mockReset();
    PATCH.mockResolvedValue({});
    PUT.mockReset();
    PUT.mockResolvedValue({});
    cuenta = null;
    centro = {
      updatedAt: 'x',
      modeloCobro: 'CENTRO',
      mediosPagoHabilitados: ['PAGO_EN_CENTRO'],
      plazoValidacionTransferenciaHoras: 24,
      porcentajePagoConfirmacion: 50,
    };
  });

  it('no ofrece la pasarela, pero la conserva si ya estaba habilitada', async () => {
    centro.mediosPagoHabilitados = ['PAGO_EN_CENTRO', 'PASARELA'];
    montar();
    await screen.findByRole('switch', { name: /Transferencia/ });
    expect(screen.queryByText(/Pasarela/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar medios de pago' }));
    expect(PATCH).toHaveBeenCalledWith('/api/configuracion', {
      body: { mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'PASARELA'], plazoValidacionTransferenciaHoras: 24, porcentajePagoConfirmacion: 50 },
    });
  });

  it('transferencia sin cuenta del centro: no guarda y lo explica', async () => {
    montar();
    await userEvent.click(await screen.findByRole('switch', { name: /Transferencia/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar medios de pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Registra la cuenta del centro/);
    expect(PATCH).not.toHaveBeenCalled();
  });

  it('exige al menos un medio activo', async () => {
    montar();
    await userEvent.click(await screen.findByRole('switch', { name: /Pago en el centro/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar medios de pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos un medio/);
  });

  it('cuenta del centro: RUT sin digito verificador valido no se envia', async () => {
    montar();
    await userEvent.type(await screen.findByLabelText(/RUT del titular/), '76111222');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }));
    expect(PUT).not.toHaveBeenCalled();
  });
});
