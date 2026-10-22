import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { CampoRut, rutMientrasEscribe, rutNormalizado } from './CampoRut';

function Prueba({ oCorreo = false }: { oCorreo?: boolean }) {
  const [v, setV] = useState('');
  return (
    <>
      <CampoRut label="RUT" value={v} onChange={setV} oCorreo={oCorreo} />
      <output data-testid="normalizado">{rutNormalizado(v)}</output>
    </>
  );
}

describe('CampoRut (03b-4.1)', () => {
  it('formatea cualquier forma de escribirlo, con K mayuscula', () => {
    expect(rutMientrasEscribe('123456785')).toBe('12.345.678-5');
    expect(rutMientrasEscribe('12345678-5')).toBe('12.345.678-5');
    expect(rutMientrasEscribe('12.345.678-5')).toBe('12.345.678-5');
    expect(rutMientrasEscribe('7654321-k')).toBe('7.654.321-K');
    expect(rutMientrasEscribe('7 654 321 k')).toBe('7.654.321-K');
    expect(rutMientrasEscribe('1')).toBe('1');
  });

  it('normaliza para la API (sin puntos, con guion)', () => {
    expect(rutNormalizado('12.345.678-5')).toBe('12345678-5');
    expect(rutNormalizado('7.654.321-k')).toBe('7654321-K');
  });

  it('valida el digito verificador mientras se escribe', async () => {
    render(<Prueba />);
    const campo = screen.getByLabelText('RUT');
    await userEvent.type(campo, '123456781');
    expect(campo).toHaveValue('12.345.678-1');
    expect(screen.getByRole('alert')).toHaveTextContent('dígito verificador');
    await userEvent.clear(campo);
    await userEvent.type(campo, '123456785');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('normalizado')).toHaveTextContent('12345678-5');
  });

  it('en el login deja pasar un correo sin formatearlo ni validarlo como RUT', async () => {
    render(<Prueba oCorreo />);
    const campo = screen.getByLabelText('RUT');
    await userEvent.type(campo, 'ana@centro.cl');
    expect(campo).toHaveValue('ana@centro.cl');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
