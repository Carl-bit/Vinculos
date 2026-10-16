import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ADVERTENCIA_TEXTO_LIBRE, faltantes, FormularioDinamico, type CampoPlantilla, type ValoresPlantilla } from './FormularioDinamico';

const campo = (c: Partial<CampoPlantilla> & Pick<CampoPlantilla, 'clave' | 'etiqueta' | 'tipo'>): CampoPlantilla => ({
  obligatorio: false,
  orden: 0,
  visible_en_supervision: false,
  es_texto_libre: false,
  ...c,
});

const CAMPOS: CampoPlantilla[] = [
  campo({ clave: 'notas', etiqueta: 'Notas', tipo: 'TEXTO_LARGO', orden: 6, es_texto_libre: true }),
  campo({ clave: 'motivo', etiqueta: 'Motivo', tipo: 'TEXTO', orden: 1, obligatorio: true }),
  campo({ clave: 'sesiones', etiqueta: 'Sesiones previas', tipo: 'NUMERO', orden: 2 }),
  campo({ clave: 'inicio', etiqueta: 'Inicio de síntomas', tipo: 'FECHA', orden: 3 }),
  campo({ clave: 'modalidad', etiqueta: 'Modalidad', tipo: 'SELECCION_UNICA', orden: 4, opciones: ['Presencial', 'Online'] }),
  campo({ clave: 'areas', etiqueta: 'Áreas', tipo: 'SELECCION_MULTIPLE', orden: 5, opciones: ['Sueño', 'Ánimo', 'Ansiedad'], obligatorio: true }),
  campo({ clave: 'riesgo', etiqueta: 'Riesgo', tipo: 'SI_NO', orden: 7 }),
];

function Prueba({ alCambiar }: { alCambiar: (v: ValoresPlantilla) => void }) {
  const [valores, setValores] = useState<ValoresPlantilla>({});
  return (
    <FormularioDinamico
      campos={CAMPOS}
      valores={valores}
      onChange={(v) => {
        setValores(v);
        alCambiar(v);
      }}
    />
  );
}

describe('FormularioDinamico', () => {
  it('renderiza cada tipo en el orden de la plantilla, con obligatorios y advertencia de texto libre', () => {
    render(<Prueba alCambiar={() => {}} />);
    const etiquetas = screen
      .getAllByText(/Motivo|Sesiones previas|Inicio de síntomas|Modalidad|Áreas|Notas|Riesgo/)
      .map((e) => e.textContent?.replace(' *', ''));
    expect(etiquetas).toEqual(['Motivo', 'Sesiones previas', 'Inicio de síntomas', 'Modalidad', 'Áreas', 'Notas', 'Riesgo']);
    expect(screen.getByLabelText(/Motivo/)).toBeRequired();
    expect(screen.getByLabelText('Sesiones previas')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Inicio de síntomas')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Notas')).toHaveAccessibleDescription(ADVERTENCIA_TEXTO_LIBRE);
    expect(screen.getByRole('group', { name: /Áreas/ })).toBeInTheDocument();
  });

  it('entrega valores con el tipo que espera la API y quita los vaciados', async () => {
    const usuario = userEvent.setup();
    let ultimo: ValoresPlantilla = {};
    render(<Prueba alCambiar={(v) => (ultimo = v)} />);

    await usuario.type(screen.getByLabelText(/Motivo/), 'Insomnio');
    await usuario.type(screen.getByLabelText('Sesiones previas'), '3');
    await usuario.selectOptions(screen.getByLabelText('Modalidad'), 'Online');
    await usuario.click(screen.getByLabelText('Sueño'));
    await usuario.click(screen.getByLabelText('Ansiedad'));
    await usuario.click(screen.getByLabelText('No'));
    expect(ultimo).toEqual({ motivo: 'Insomnio', sesiones: 3, modalidad: 'Online', areas: ['Sueño', 'Ansiedad'], riesgo: false });

    await usuario.clear(screen.getByLabelText(/Motivo/));
    await usuario.click(screen.getByLabelText('Sueño'));
    await usuario.click(screen.getByLabelText('Ansiedad'));
    expect(ultimo).not.toHaveProperty('motivo');
    expect(ultimo).not.toHaveProperty('areas');
  });

  it('faltantes() marca solo obligatorios vacios', () => {
    expect(Object.keys(faltantes(CAMPOS, {}))).toEqual(['motivo', 'areas']);
    expect(faltantes(CAMPOS, { motivo: 'x', areas: ['Sueño'] })).toEqual({});
  });
});
