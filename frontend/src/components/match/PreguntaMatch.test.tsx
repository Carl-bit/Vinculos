import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { lista, MIN_RELATO, PreguntaMatch, type Pregunta, type Respuesta } from './PreguntaMatch';

const relato = {
  id: 'r',
  clave: 'relato',
  texto: 'Cuéntanos con tus palabras',
  ayuda: null,
  tipo: 'TEXTO',
  obligatoria: true,
  max_selecciones: null,
  opciones: [],
} as unknown as Pregunta;

function Prueba() {
  const [v, setV] = useState<Respuesta>();
  return (
    <>
      <PreguntaMatch pregunta={relato} valor={v} onChange={setV} />
      <button type="button" disabled={!lista(relato, v)}>
        Continuar
      </button>
    </>
  );
}

describe('Relato del match (03b-4.1)', () => {
  it('muestra el minimo mientras escribe y Continuar queda deshabilitado bajo el minimo', async () => {
    render(<Prueba />);
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();
    expect(screen.getByText(`Escribe al menos ${MIN_RELATO} caracteres.`)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'Duermo');
    expect(screen.getByText(/te faltan 4/)).toBeInTheDocument();
    expect(continuar).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), ' mal hace meses');
    expect(continuar).toBeEnabled();
    expect(screen.getByText('Listo, puedes continuar.')).toBeInTheDocument();
  });

  it('opcional: vacio avanza, un relato a medias no', () => {
    const opcional = { ...relato, obligatoria: false } as Pregunta;
    expect(lista(opcional, undefined)).toBe(true);
    expect(lista(opcional, 'corto')).toBe(false);
  });
});
