import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContratoPendiente } from './ContratoCentro';

const dpa = { tipo: 'DPA' as const, politicaId: 'p1', version: 2, texto: 'Texto del anexo de prueba.', vigenteDesde: '2026-10-28T12:00:00Z', aceptaciones: [] };
let respuesta = { pendientes: ['DPA' as const], vigentes: [dpa] };
const get = vi.fn(async () => ({ data: respuesta }));
const post = vi.fn(async () => ({ data: { pendientes: [], vigentes: [{ ...dpa, aceptaciones: [{ por: 'Admin', aceptadaEn: '2026-10-28T13:00:00Z' }] }] } }));

vi.mock('@/lib/api/cliente', () => ({
  api: { GET: (...a: unknown[]) => get(...(a as [])), POST: (...a: unknown[]) => post(...(a as [])) },
  datos: async <T,>(p: Promise<{ data: T }>) => (await p).data,
}));

const envolver = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** AUD-01 (E2.2): la cuenta madre acepta la version vigente del contrato antes de seguir. */
describe('ContratoPendiente', () => {
  beforeAll(() => {
    // jsdom no implementa <dialog>: el Modal del sistema lo abre con showModal().
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  beforeEach(() => {
    get.mockClear();
    post.mockClear();
    respuesta = { pendientes: ['DPA'], vigentes: [dpa] };
  });

  it('ADMIN con DPA pendiente: muestra el texto y la version; aceptar registra y cierra el aviso', async () => {
    envolver(<ContratoPendiente esAdmin />);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Anexo de tratamiento de datos (DPA)');
    expect(screen.getByText('Texto del anexo de prueba.')).toBeInTheDocument();
    expect(screen.getByText(/Versión 2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Acepto a nombre del centro' }));
    expect(post).toHaveBeenCalledWith('/api/contrato-centro/aceptacion', { body: { tipo: 'DPA' } });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sin pendientes no muestra nada', async () => {
    respuesta = { pendientes: [] as never[], vigentes: [dpa] } as never;
    envolver(<ContratoPendiente esAdmin />);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('otro rol: ni consulta', () => {
    envolver(<ContratoPendiente esAdmin={false} />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
