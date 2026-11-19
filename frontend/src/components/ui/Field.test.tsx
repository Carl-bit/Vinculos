import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Select, Textarea } from './Field';

describe('Textarea enterEnvia (punto 14)', () => {
  const armar = () => {
    const enviar = vi.fn((e: Event) => e.preventDefault());
    render(
      <form onSubmit={(e) => enviar(e.nativeEvent)}>
        <Textarea aria-label="Mensaje" enterEnvia defaultValue="hola" />
      </form>,
    );
    return { enviar, caja: screen.getByLabelText('Mensaje') };
  };
  it('Enter envia', () => {
    const { enviar, caja } = armar();
    fireEvent.keyDown(caja, { key: 'Enter' });
    expect(enviar).toHaveBeenCalledTimes(1);
  });
  it('Shift+Enter no envia', () => {
    const { enviar, caja } = armar();
    fireEvent.keyDown(caja, { key: 'Enter', shiftKey: true });
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('Select buscable (2026-11-18)', () => {
  it('filtra mientras se escribe, sin tildes ni mayusculas, y Enter elige la primera que calza', () => {
    const elegir = vi.fn();
    render(
      <Select aria-label="Paciente" buscable value="" onChange={(e) => elegir(e.target.value)}>
        <option value="">Elige un paciente</option>
        <option value="a">
          {'Pérez'}, {'Ana'}
        </option>
        <option value="b">
          {'Soto'}, {'Luis'}
        </option>
      </Select>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Paciente' }));
    const buscar = screen.getByLabelText('Buscar en la lista');
    fireEvent.change(buscar, { target: { value: 'perez' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Pérez, Ana']);
    fireEvent.keyDown(buscar, { key: 'Enter' });
    expect(elegir).toHaveBeenCalledWith('a');
  });
});
