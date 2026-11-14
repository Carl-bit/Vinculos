import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Usuario = ReturnType<typeof userEvent.setup> | typeof userEvent;

/**
 * Tests: elige una opcion en un `Select` (ListaSeleccion) o `CampoHora`, que
 * ya no son <select> nativos. Abre la lista y hace clic en la opcion por su
 * texto visible. El valor elegido queda en `data-valor` del control.
 */
export async function elegirOpcion(usuario: Usuario, control: HTMLElement, opcion: string | RegExp) {
  await usuario.click(control);
  await usuario.click(screen.getByRole('option', { name: opcion }));
}

/** Tests: textos de las opciones de un `Select` (abre la lista y la deja abierta). */
export async function opcionesDe(usuario: Usuario, control: HTMLElement) {
  await usuario.click(control);
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}
