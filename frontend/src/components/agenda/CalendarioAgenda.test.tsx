import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { semanaChile } from '@/lib/panel';

import { CalendarioAgenda } from './CalendarioAgenda';

/** Consulta resuelta con datos (forma minima que usa EstadoConsulta). */
const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });

const martes = semanaChile(0).dias[1]!;
const enChile = (hora: string) => new Date(`${martes}T${hora}:00-03:00`).toISOString();

vi.mock('@/components/shared/EquipoActivo', () => ({ useEquipoActivo: () => ({ profesionalId: null, setProfesionalId: vi.fn() }) }));
vi.mock('@/lib/panel', async (original) => ({
  ...(await original<typeof import('@/lib/panel')>()),
  useCitas: () =>
    lista([
      {
        id: 'c1',
        estado: 'CONFIRMADA',
        inicio: enChile('10:00'),
        fin: enChile('10:50'),
        profesionalId: 'p1',
        pacienteId: 'pa1',
        espacioId: 'b1',
        modalidad: 'PRESENCIAL',
      },
    ]),
  useRetencionesAjenas: () => lista([{ espacioId: 'b1', inicio: enChile('15:00'), fin: enChile('15:50') }]),
  useEquipoAgenda: () => lista([{ id: 'p1', nombre: 'Profesional Uno' }]),
  useEspacios: () => lista([{ id: 'b1', nombre: 'Box 1' }]),
  usePacientes: () => lista([{ id: 'pa1', nombre: 'Ana', apellido: 'Demo' }]),
}));

describe('CalendarioAgenda (03b-4.1)', () => {
  it('sesion confirmada con punto y fondo del tono, sin borde lateral grueso', () => {
    render(<CalendarioAgenda rol="ADMIN" onElegir={vi.fn()} />);
    const sesion = screen.getByRole('button', { name: /Ana Demo/ });
    expect(sesion.className).not.toMatch(/border-l-4/);
    expect(sesion.className).toMatch(/bg-accent-2-100/);
    expect(within(sesion).getByText('Confirmada')).toBeInTheDocument();
  });

  it('"Reservando…" de otra persona: box y rango, sin quien, y en la leyenda', () => {
    render(<CalendarioAgenda rol="ADMIN" onElegir={vi.fn()} />);
    expect(screen.getByText('Reservando…')).toBeInTheDocument();
    expect(screen.getByText(/Box 1 · otra persona está eligiendo este horario/)).toBeInTheDocument();
    expect(screen.getByText('Reservando', { selector: 'li' })).toBeInTheDocument();
    // No es un boton: no abre detalle ni revela a quien retiene.
    expect(screen.queryByRole('button', { name: /Reservando/ })).toBeNull();
  });
});
