import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Rol } from '@/lib/sesion';

import { TransferenciasPorValidar } from './TransferenciasPorValidar';

const POST = vi.hoisted(() => vi.fn());
let modeloCobro = 'CENTRO';
const fila = (extra = {}) => ({
  id: 't1',
  citaId: 'c1',
  estado: 'POR_VALIDAR',
  comprobanteRecibido: true,
  motivoRechazo: null,
  profesionalId: 'p1',
  pacienteId: 'pa1',
  inicio: '2026-11-03T13:00:00.000Z',
  pagoVenceEn: '2026-11-02T13:00:00.000Z',
  monto: 40000,
  ...extra,
});
let lista: unknown[] = [];
const consulta = <T,>(data: T) => ({ data, isSuccess: true, isPending: false, isError: false, error: null, refetch: vi.fn() });

vi.mock('@/lib/api/cliente', () => ({ api: { POST }, datos: (r: unknown) => r }));
vi.mock('@/lib/centro', () => ({ useConfiguracionCentro: () => consulta({ modeloCobro }) }));
vi.mock('@/lib/cobros', () => ({ useTransferencias: () => consulta(lista) }));
vi.mock('@/lib/panel', async (original) => ({
  ...(await original<typeof import('@/lib/panel')>()),
  usePacientes: () => consulta([{ id: 'pa1', nombre: 'Ana', apellido: 'Demo' }]),
  useEquipoAgenda: () => consulta([{ id: 'p1', nombre: 'Profesional Uno' }]),
}));

const montar = (rol: Rol) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TransferenciasPorValidar rol={rol} />
    </QueryClientProvider>,
  );

describe('TransferenciasPorValidar', () => {
  beforeEach(() => {
    // jsdom no implementa <dialog>: el Modal del sistema lo abre con showModal().
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
    POST.mockReset();
    POST.mockResolvedValue({});
    modeloCobro = 'CENTRO';
    lista = [fila()];
  });

  it('muestra paciente, profesional y comprobante; la reserva sin cuenta se identifica como tal', () => {
    lista = [fila(), fila({ id: 't2', pacienteId: null, comprobanteRecibido: false })];
    montar('ADMIN');
    expect(screen.getByText('Ana Demo')).toBeInTheDocument();
    expect(screen.getByText('Reserva sin cuenta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver comprobante' })).toBeInTheDocument();
    expect(screen.getByText('Sin comprobante')).toBeInTheDocument();
  });

  it('cobro del centro: ADMIN valida; el profesional solo mira', async () => {
    const { unmount } = montar('PROFESIONAL');
    expect(screen.queryByRole('button', { name: 'Validar' })).toBeNull();
    unmount();
    montar('GESTION');
    await userEvent.click(screen.getByRole('button', { name: 'Validar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Validar y registrar pago' }));
    expect(POST).toHaveBeenCalledWith('/api/cobros/citas/{id}/transferencia/validacion', { params: { path: { id: 'c1' } } });
  });

  it('cobro directo: valida el profesional, administracion no', () => {
    modeloCobro = 'DIRECTO';
    const { unmount } = montar('ADMIN');
    expect(screen.queryByRole('button', { name: 'Validar' })).toBeNull();
    unmount();
    montar('PROFESIONAL');
    expect(screen.getByRole('button', { name: 'Validar' })).toBeInTheDocument();
  });

  it('rechazar exige motivo y lo envia', async () => {
    montar('ADMIN');
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const modal = within(screen.getByRole('dialog'));
    await userEvent.click(modal.getByRole('button', { name: 'Rechazar' }));
    expect(modal.getByRole('alert')).toHaveTextContent(/Escribe el motivo/);
    expect(POST).not.toHaveBeenCalled();
    await userEvent.type(modal.getByLabelText(/Motivo del rechazo/), 'El monto no coincide');
    await userEvent.click(modal.getByRole('button', { name: 'Rechazar' }));
    expect(POST).toHaveBeenCalledWith('/api/cobros/citas/{id}/transferencia/rechazo', {
      params: { path: { id: 'c1' } },
      body: { motivo: 'El monto no coincide' },
    });
  });
});
