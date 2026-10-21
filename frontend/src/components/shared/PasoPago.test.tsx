import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CaminoPago, EstadoConfirmacion } from '@/lib/pagos';

import { PasoPago } from './PasoPago';

const base: EstadoConfirmacion = {
  estado: 'PENDIENTE_PAGO',
  venceEn: '2026-10-25T15:00:00.000Z',
  siguiente: 'ELEGIR_MEDIO',
  medios: ['PAGO_EN_CENTRO', 'TRANSFERENCIA', 'PASARELA'],
  medio: null,
  monto: 15000,
  comprobanteRecibido: false,
  motivoRechazo: null,
  pasarelaSimulada: true,
};

const camino = (extra: Partial<CaminoPago> = {}): CaminoPago => ({
  clave: ['prueba'],
  sinCuenta: false,
  estado: vi.fn(),
  elegir: vi.fn(async (medio: EstadoConfirmacion['medio']) => ({
    ...base,
    estado: medio === 'PAGO_EN_CENTRO' ? ('CONFIRMADA' as const) : ('PENDIENTE_PAGO' as const),
    medio,
  })),
  transferencia: vi.fn(async () => ({
    origen: 'CENTRO' as const,
    rut: '11.111.111-1',
    banco: 'Banco Demo',
    tipoCuenta: 'Corriente',
    numeroCuenta: '000-123456',
    titular: 'Centro de Prueba SpA',
    monto: 15000,
    venceEn: base.venceEn!,
  })),
  comprobante: vi.fn(),
  pasarela: vi.fn(async () => ({ referencia: 'ref-1', urlPago: 'http://localhost/pago-simulado', simulada: true })),
  ...extra,
});

const conCliente = (hijo: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{hijo}</QueryClientProvider>);

describe('PasoPago', () => {
  beforeAll(() => {
    // jsdom no implementa <dialog>: el Modal del sistema lo abre con showModal().
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  it('muestra los medios habilitados con el monto y el plazo; pide elegir uno; pago en el centro confirma', async () => {
    const c = camino();
    conCliente(<PasoPago camino={c} estado={base} />);
    expect(screen.getByText(/Para confirmar tu hora pagas/)).toHaveTextContent('15.000');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByLabelText(/Pago en línea \(modo demostración\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Elige cómo vas a pagar.')).toBeInTheDocument();
    expect(c.elegir).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText(/Pago en el centro/));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(c.elegir).toHaveBeenCalledWith('PAGO_EN_CENTRO');
  });

  it('hora que agenda el equipo (03b-3.3): al vencer el plazo se paga en el centro, no se libera', () => {
    conCliente(<PasoPago camino={camino()} estado={base} seMantiene />);
    expect(screen.getByText(/Para confirmar tu hora pagas/)).toHaveTextContent('pagas en el centro el día de la atención');
    expect(screen.getByText(/Para confirmar tu hora pagas/)).not.toHaveTextContent('se libera');
  });

  it('saldo de una sesion realizada (03b-3.4): monto del saldo, solo medios en linea, sin plazo', () => {
    conCliente(
      <PasoPago camino={camino()} estado={{ ...base, estado: 'SALDO_PENDIENTE', venceEn: null, medios: ['TRANSFERENCIA', 'PASARELA'], monto: 30000 }} />,
    );
    expect(screen.getByText(/saldo pendiente de/)).toHaveTextContent('30.000');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByLabelText(/Pago en línea/)).toHaveAccessibleName(/el pago queda registrado al instante/);
  });

  it('saldo sin medios en linea: se paga en el centro', () => {
    conCliente(
      <PasoPago camino={camino()} estado={{ ...base, estado: 'SALDO_PENDIENTE', siguiente: 'PAGAR_EN_CENTRO', venceEn: null, medios: [], monto: 30000 }} />,
    );
    expect(screen.getByText(/no tiene medios de pago en línea/)).toBeInTheDocument();
  });

  it('transferencia: datos de la cuenta, plazo visible, comprobante opcional y motivo del rechazo', async () => {
    const c = camino();
    conCliente(
      <PasoPago camino={c} estado={{ ...base, siguiente: 'TRANSFERENCIA_RECHAZADA', medio: 'TRANSFERENCIA', motivoRechazo: 'El monto no coincide' }} />,
    );
    expect(await screen.findByText('000-123456')).toBeInTheDocument();
    expect(screen.getByText(/Sube el comprobante antes del plazo/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Motivo: El monto no coincide');
    expect(screen.getByRole('button', { name: 'Subir comprobante (opcional)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir otro medio de pago' })).toBeInTheDocument();
  });

  it('pasarela simulada: avisa que no se cobra y abre la pantalla de demostracion', async () => {
    const c = camino();
    conCliente(<PasoPago camino={c} estado={{ ...base, siguiente: 'PAGAR_EN_LINEA', medio: 'PASARELA' }} />);
    expect(screen.getByText('Modo demostración')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Pagar .* en línea/ }));
    expect(c.pasarela).toHaveBeenCalled();
    expect(await screen.findByText(/Modo demostración: no se realiza ningún cobro/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simular pago aprobado' })).toBeInTheDocument();
  });

  it('reserva sin cuenta (03b-3.2): pago en el centro avisa que llega un enlace al correo y permite cambiar de medio', async () => {
    const c = camino({ sinCuenta: true });
    conCliente(<PasoPago camino={c} estado={{ ...base, estado: 'RETENIDA' }} />);
    expect(screen.getByLabelText(/Te enviamos un enlace al correo/)).toBeInTheDocument();
    const { unmount } = conCliente(<PasoPago camino={c} estado={{ ...base, estado: 'RETENIDA', siguiente: 'VERIFICAR_CORREO', medio: 'PAGO_EN_CENTRO' }} />);
    expect(screen.getByText(/al abrir el enlace del correo/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Elegir otro medio de pago' })).toHaveLength(1);
    unmount();
  });
});
