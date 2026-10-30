import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeriadosCentro } from './FeriadosCentro';

vi.mock('@/lib/panel', () => ({ fechaHoyChile: () => '2026-10-28' }));

const lista = [
  { fecha: '2026-05-21', nombre: 'Día de las Glorias Navales', origen: 'LEY' as const, quitado: false },
  { fecha: '2026-12-08', nombre: 'Inmaculada Concepción', origen: 'LEY' as const, quitado: false },
  { fecha: '2026-12-15', nombre: 'Feriado regional', origen: 'CENTRO' as const, quitado: true },
];
const get = vi.fn(async () => ({ data: lista }));
const post = vi.fn(async () => ({ data: lista }));
const del = vi.fn(async () => ({ data: lista }));

vi.mock('@/lib/api/cliente', () => ({
  api: {
    GET: (...a: unknown[]) => get(...(a as [])),
    POST: (...a: unknown[]) => post(...(a as [])),
    DELETE: (...a: unknown[]) => del(...(a as [])),
  },
  datos: async <T,>(p: Promise<{ data: T }>) => (await p).data,
}));

const envolver = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** AUD-01 (E2.3a): los de la ley vienen calculados; el ADMIN agrega, quita y repone de hoy en adelante. */
describe('FeriadosCentro', () => {
  beforeEach(() => {
    get.mockClear();
    post.mockClear();
    del.mockClear();
  });

  it('lista con origen; solo los futuros se pueden quitar o reponer', async () => {
    envolver(<FeriadosCentro />);
    const pasado = (await screen.findByText('Día de las Glorias Navales')).closest('tr')!;
    expect(within(pasado).queryByRole('button')).toBeNull();
    const futuro = screen.getByText('Inmaculada Concepción').closest('tr')!;
    await userEvent.click(within(futuro).getByRole('button', { name: 'Quitar' }));
    expect(del).toHaveBeenCalledWith('/api/feriados/{fecha}', { params: { path: { fecha: '2026-12-08' } } });
    const quitado = screen.getByText('Feriado regional').closest('tr')!;
    expect(within(quitado).getByText('Quitado')).toBeInTheDocument();
    await userEvent.click(within(quitado).getByRole('button', { name: 'Reponer' }));
    expect(post).toHaveBeenCalledWith('/api/feriados', { body: { fecha: '2026-12-15', nombre: 'Feriado regional' } });
  });

  it('agregar exige fecha de hoy en adelante y nombre', async () => {
    envolver(<FeriadosCentro />);
    await screen.findByText('Inmaculada Concepción');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar feriado' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una fecha de hoy en adelante.');
    expect(post).not.toHaveBeenCalled();
  });
});
