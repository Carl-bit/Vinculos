import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { diasDelMes, FechaNacimiento } from './FechaNacimiento';

function Prueba() {
  const [v, setV] = useState('');
  return (
    <>
      <FechaNacimiento label="Fecha de nacimiento" value={v} onChange={setV} avisoMenor="Es menor de edad" />
      <output data-testid="valor">{v}</output>
    </>
  );
}

describe('FechaNacimiento (03b-4.1)', () => {
  it('dias segun mes y año, con bisiestos', () => {
    expect(diasDelMes(2024, 2)).toBe(29);
    expect(diasDelMes(2023, 2)).toBe(28);
    expect(diasDelMes(1900, 2)).toBe(28);
    expect(diasDelMes(2000, 2)).toBe(29);
    expect(diasDelMes(2025, 4)).toBe(30);
    expect(diasDelMes(2025, 12)).toBe(31);
  });

  it('arma AAAA-MM-DD, borra un dia que deja de existir y avisa si es menor', async () => {
    render(<Prueba />);
    await userEvent.selectOptions(screen.getByLabelText('Día'), '31');
    await userEvent.selectOptions(screen.getByLabelText('Mes'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Año'), '1990');
    expect(screen.getByTestId('valor')).toHaveTextContent('1990-01-31');
    // Febrero no tiene 31: el dia se borra y la fecha queda incompleta.
    await userEvent.selectOptions(screen.getByLabelText('Mes'), '2');
    expect(screen.getByTestId('valor')).toHaveTextContent('');
    expect(screen.getByLabelText('Día').querySelectorAll('option')).toHaveLength(29); // 28 dias + "Día"
    await userEvent.selectOptions(screen.getByLabelText('Día'), '15');
    expect(screen.getByTestId('valor')).toHaveTextContent('1990-02-15');
    expect(screen.queryByText('Es menor de edad')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Año'), String(new Date().getFullYear() - 10));
    expect(screen.getByText('Es menor de edad')).toBeInTheDocument();
  });
});
