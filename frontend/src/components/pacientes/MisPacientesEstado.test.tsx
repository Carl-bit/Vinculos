import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MisPacientesEstado } from './MisPacientesEstado';

const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });

vi.mock('@/lib/panel', () => ({
  usePacientes: () =>
    lista([
      { id: 'a', nombre: 'Ana', apellido: 'Pendiente' },
      { id: 'b', nombre: 'Beto', apellido: 'Alta' },
      { id: 'c', nombre: 'Caro', apellido: 'AlDia' },
    ]),
  useEstadoFichas: () =>
    lista([
      { paciente_id: 'a', sesiones_sin_cerrar: 2, alta_en: null, proxima_sesion: '2026-12-02T15:00:00Z' },
      { paciente_id: 'b', sesiones_sin_cerrar: 0, alta_en: '2026-10-01T12:00:00Z', proxima_sesion: null },
      { paciente_id: 'c', sesiones_sin_cerrar: 0, alta_en: null, proxima_sesion: '2026-12-01T15:00:00Z' },
    ]),
}));

describe('Mis pacientes: estado administrativo (MVP sin COBROS)', () => {
  it('ficha sin cerrar, alta y al dia; ordenados por proxima sesion; sin estado de pago', () => {
    render(<MisPacientesEstado profesionalId="p1" />);
    const fila = (nombre: RegExp) => screen.getByRole('link', { name: nombre });
    expect(within(fila(/Ana Pendiente/)).getByText('Ficha sin cerrar')).toBeInTheDocument();
    expect(within(fila(/Beto Alta/)).getByText('Alta')).toBeInTheDocument();
    expect(within(fila(/Caro AlDia/)).getByText('Al día')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Ana|Beto|Caro/ }).map((l) => l.textContent?.match(/Ana|Beto|Caro/)?.[0])).toEqual(['Caro', 'Ana', 'Beto']);
    expect(screen.queryByText(/deuda|pago/i)).toBeNull();
  });
});
