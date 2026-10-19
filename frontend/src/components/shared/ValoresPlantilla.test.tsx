import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CampoPlantilla } from './FormularioDinamico';
import { ValoresPlantilla } from './ValoresPlantilla';

const campo = (c: Partial<CampoPlantilla> & Pick<CampoPlantilla, 'clave' | 'etiqueta' | 'tipo'>): CampoPlantilla => ({
  obligatorio: false,
  orden: 0,
  visible_en_supervision: false,
  es_texto_libre: false,
  ...c,
});

describe('ValoresPlantilla', () => {
  it('muestra cada valor con la etiqueta y el formato de su version, en el orden de la plantilla', () => {
    render(
      <ValoresPlantilla
        campos={[
          campo({ clave: 'previo', etiqueta: 'Tratamiento previo', tipo: 'SI_NO', orden: 3 }),
          campo({ clave: 'motivo', etiqueta: 'Motivo', tipo: 'TEXTO', orden: 1 }),
          campo({ clave: 'areas', etiqueta: 'Áreas', tipo: 'SELECCION_MULTIPLE', orden: 2, opciones: ['Sueño', 'Ánimo'] }),
          campo({ clave: 'vacio', etiqueta: 'Sin respuesta', tipo: 'TEXTO', orden: 4 }),
        ]}
        valores={{ previo: false, motivo: 'Insomnio', areas: ['Sueño', 'Ánimo'] }}
      />,
    );
    const etiquetas = screen.getAllByRole('term').map((t) => t.textContent);
    expect(etiquetas).toEqual(['Motivo', 'Áreas', 'Tratamiento previo']);
    expect(screen.getByText('Sueño, Ánimo')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.queryByText('Sin respuesta')).not.toBeInTheDocument();
  });

  it('sin valores muestra el texto de vacio', () => {
    render(<ValoresPlantilla campos={[campo({ clave: 'x', etiqueta: 'X', tipo: 'TEXTO' })]} valores={null} vacio="Nada registrado" />);
    expect(screen.getByText('Nada registrado')).toBeInTheDocument();
  });
});
