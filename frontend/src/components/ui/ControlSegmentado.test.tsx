import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { SelectorPeriodo, type VistaAgenda } from '@/components/agenda/SelectorPeriodo';

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

function Periodo() {
  const [vista, setVista] = useState<VistaAgenda>('semana');
  const [n, setN] = useState(0);
  return <SelectorPeriodo vista={vista} onVista={setVista} etiqueta={vista + ' ' + n} desplazamiento={n} onDesplazar={setN} />;
}

describe('ControlSegmentado y Semana | Mes (03b-4.1)', () => {
  it('radios nativos: clic y flechas del teclado cambian la opcion activa', async () => {
    render(<Modalidad />);
    expect(screen.getByRole('group', { name: 'Modalidad' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Presencial' })).toBeChecked();
    await userEvent.click(screen.getByText('Online'));
    expect(screen.getByRole('radio', { name: 'Online' })).toBeChecked();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Presencial' })).toBeChecked();
  });

  it('Semana | Mes, flechas del periodo y Hoy (deshabilitado en el periodo actual)', async () => {
    render(<Periodo />);
    const hoy = screen.getByRole('button', { name: 'Hoy' });
    expect(hoy).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(screen.getByText('semana 1')).toBeInTheDocument();
    expect(hoy).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Mes' }));
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeInTheDocument();
    await userEvent.click(hoy);
    expect(screen.getByText('mes 0')).toBeInTheDocument();
  });
});
