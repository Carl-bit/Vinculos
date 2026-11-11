import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Textarea } from './Field';

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
