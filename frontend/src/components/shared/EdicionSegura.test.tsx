import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogoDescartar, useGuardaCambios } from './EdicionSegura';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function Editor() {
  const [texto, setTexto] = useState('');
  const [salidas, setSalidas] = useState(0);
  const guarda = useGuardaCambios(texto !== '');
  return (
    <>
      <input aria-label="Texto" value={texto} onChange={(e) => setTexto(e.target.value)} />
      <a href="/otra">Ir</a>
      <button type="button" onClick={() => guarda.confirmar(() => setSalidas((n) => n + 1))}>
        Salir
      </button>
      <span>salidas {salidas}</span>
      <DialogoDescartar seccion="Cabecera" {...guarda.dialogo} />
    </>
  );
}

describe('useGuardaCambios', () => {
  beforeEach(() => {
    // jsdom no implementa <dialog>: el Modal del sistema lo abre con showModal().
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  it('sin cambios corre la accion; con cambios pide confirmar y la corre con Sí', async () => {
    const u = userEvent.setup();
    render(<Editor />);
    await u.click(screen.getByRole('button', { name: 'Salir' }));
    expect(screen.getByText('salidas 1')).toBeTruthy();

    await u.type(screen.getByLabelText('Texto'), 'hola');
    await u.click(screen.getByRole('button', { name: 'Salir' }));
    expect(screen.getByText('salidas 1')).toBeTruthy();
    expect(screen.getByText('Estás modificando «Cabecera»')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Sí, descartar', hidden: true }));
    expect(screen.getByText('salidas 2')).toBeTruthy();
  });

  it('con cambios, un enlace interno espera la confirmación', async () => {
    const u = userEvent.setup();
    render(<Editor />);
    await u.type(screen.getByLabelText('Texto'), 'x');
    await u.click(screen.getByRole('link', { name: 'Ir' }));
    expect(push).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Sí, descartar', hidden: true }));
    expect(push).toHaveBeenCalledWith('/otra');
  });
});
