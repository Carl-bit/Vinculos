import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ControlSegmentado } from './ControlSegmentado';

function Modalidad() {
  const [v, setV] = useState<'ONLINE' | 'PRESENCIAL'>('PRESENCIAL');
  return (
    <ControlSegmentado
      etiqueta="Modalidad"
      valor={v}
      onChange={setV}
      opciones={[
        { valor: 'PRESENCIAL', etiqueta: 'Presencial', icono: 'meeting_room' },
        { valor: 'ONLINE', etiqueta: 'Online', icono: 'videocam' },
      ]}
    />
  );
}

describe('ControlSegmentado (03b-4.1)', () => {
  it('radios nativos: clic y flechas del teclado cambian la opcion activa', async () => {
    render(<Modalidad />);
    expect(screen.getByRole('group', { name: 'Modalidad' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Presencial' })).toBeChecked();
    await userEvent.click(screen.getByText('Online'));
    expect(screen.getByRole('radio', { name: 'Online' })).toBeChecked();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Presencial' })).toBeChecked();
  });
});
