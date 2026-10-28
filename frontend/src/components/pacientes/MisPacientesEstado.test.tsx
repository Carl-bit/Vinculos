import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MisPacientesEstado } from './MisPacientesEstado';

const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });

vi.mock('@/lib/consultas', () => ({ useModulos: () => lista({ activos: ['FICHAS', 'AGENDA', 'COBROS'] }) }));
vi.mock('@/lib/cobros', () => ({ useDeudas: () => lista([{ paciente_id: 'a', saldo: 35000, sesiones: 1, desde: '2026-10-20T15:00:00Z', citas: ['c0'] }]) }));
vi.mock('@/lib/panel', () => ({
  usePacientes: () =>
    lista([
      { id: 'a', nombre: 'Ana', apellido: 'Deuda' },
      { id: 'b', nombre: 'Beto', apellido: 'Pendiente' },
      { id: 'c', nombre: 'Caro', apellido: 'AlDia' },
    ]),
  useEstadoFichas: () => lista([]),
  useCitas: () => lista([{ id: 'c1', pacienteId: 'b', estado: 'PENDIENTE_PAGO' }]),
}));

describe('Mis pacientes: estado de pago (03b-4.1, pendiente 9)', () => {
  it('"Con deuda" con el saldo, "Pago pendiente" y nada cuando esta al dia', () => {
    render(<MisPacientesEstado profesionalId="p1" />);
    const fila = (nombre: RegExp) => screen.getByRole('link', { name: nombre });
    expect(within(fila(/Ana Deuda/)).getByText(/Con deuda · \$35\.000/)).toBeInTheDocument();
    expect(within(fila(/Beto Pendiente/)).getByText('Pago pendiente')).toBeInTheDocument();
    expect(within(fila(/Caro AlDia/)).queryByText(/Con deuda|Pago pendiente/)).toBeNull();
    expect(screen.queryByText('Por confirmar')).toBeNull();
  });
});
