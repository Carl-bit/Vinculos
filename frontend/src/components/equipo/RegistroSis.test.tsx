import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InsigniaRegistroSis, URL_RNPI } from './RegistroSis';

describe('InsigniaRegistroSis (03b-4.2)', () => {
  it('sin registro verificado no se muestra', () => {
    const { container } = render(<InsigniaRegistroSis registro={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('verificado contra el RNPI: numero, fecha y enlace al buscador publico', () => {
    render(<InsigniaRegistroSis registro={{ numero: '123456', estado: 'VERIFICADO_AUTOMATICO', verificado_en: '2026-10-20T15:00:00Z' }} />);
    expect(screen.getByText('Registro SIS N.º 123456')).toBeInTheDocument();
    expect(screen.getByText(/Verificado el/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Consultar en la Superintendencia/ })).toHaveAttribute('href', URL_RNPI);
  });

  it('verificado a mano: "Verificado por el centro"', () => {
    render(<InsigniaRegistroSis registro={{ numero: '77', estado: 'VERIFICADO_MANUAL', verificado_en: '2026-10-20T15:00:00Z' }} />);
    expect(screen.getByText('Verificado por el centro')).toBeInTheDocument();
  });
});
