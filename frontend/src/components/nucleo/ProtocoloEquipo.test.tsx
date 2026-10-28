import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LecturasProtocolo, ProtocoloEquipo } from './ProtocoloEquipo';

const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });
const vigente = { id: 'v2', version: 2, texto: 'Registrar la evolucion dentro de 48 horas.', vigenteDesde: '2026-10-20T12:00:00Z' };
const marcar = vi.fn();
let leidoEn: string | null = null;

vi.mock('@/lib/centro', () => ({
  useProtocoloEquipo: () => lista({ vigente, leidoEn }),
  useMarcarProtocoloLeido: () => ({ mutate: marcar, isPending: false, error: null }),
  useLecturasProtocolo: () => lista([{ usuarioId: 'u1', rol: 'PROFESIONAL', leidoEn: '2026-10-21T15:00:00Z' }]),
  useDirectorioEquipo: () =>
    lista([
      { id: 'u1', nombre: 'Uno Leyo', roles: ['PROFESIONAL'] },
      { id: 'u2', nombre: 'Dos Falta', roles: ['PRACTICANTE'] },
    ]),
}));

describe('Protocolo del centro (03b-4.2)', () => {
  beforeEach(() => marcar.mockClear());

  it('pendiente: muestra la version y "Marcar como leído" registra la lectura', () => {
    leidoEn = null;
    render(<ProtocoloEquipo />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText(/Versión 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leído' }));
    expect(marcar).toHaveBeenCalledOnce();
  });

  it('leido: sin boton, con la fecha de lectura', () => {
    leidoEn = '2026-10-21T15:00:00Z';
    render(<ProtocoloEquipo />);
    expect(screen.getByText('Leído')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como leído' })).toBeNull();
    expect(screen.getByText(/Lo marcaste como leído el/)).toBeInTheDocument();
  });

  it('registro para la direccion: quien lo leyo y quien falta', () => {
    render(<LecturasProtocolo />);
    expect(screen.getByText(/1 de 2 integrantes lo leyeron · 1 pendiente/)).toBeInTheDocument();
    const fila = (nombre: string) => screen.getByText(nombre).closest('li')!;
    expect(within(fila('Uno Leyo')).getByText(/Leído ·/)).toBeInTheDocument();
    expect(within(fila('Dos Falta')).getByText('Pendiente')).toBeInTheDocument();
  });
});
