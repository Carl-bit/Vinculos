import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { DocumentoTributarioVista } from '@/lib/cobros';

import { DocumentosTributarios } from './DocumentosTributarios';

const envolver = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const doc: DocumentoTributarioVista = {
  id: 'd1',
  citaId: 'c1',
  tipo: 'BOLETA_ELECTRONICA',
  folio: '1001',
  emisor: 'CENTRO',
  fechaEmision: '2026-10-28',
  monto: 30000,
  estado: 'REGISTRADO',
  registradoEn: '2026-10-28T15:00:00.000Z',
  anuladoEn: null,
  motivoAnulacion: null,
};

/** AUD-01 (E1.4): la boleta del SII la anota quien cobro; el comprobante del sistema no la reemplaza. */
describe('DocumentosTributarios', () => {
  it('cobra el centro: GESTION registra; el tipo honorarios no se ofrece', async () => {
    envolver(<DocumentosTributarios citaId="c1" documentos={[]} emiteProfesional={false} pagadoSinDocumentar={30000} rol="GESTION" />);
    await userEvent.click(screen.getByRole('button', { name: /Registrar boleta emitida/ }));
    const tipos = screen.getByLabelText(/Tipo de documento/);
    expect(tipos).toHaveTextContent('Boleta electrónica');
    expect(tipos).not.toHaveTextContent('Boleta de honorarios');
    expect(screen.getByLabelText(/Monto/)).toHaveValue('30000');
  });

  it('cobra el centro: el profesional solo ve lo registrado, sin registrar ni anular', () => {
    envolver(<DocumentosTributarios citaId="c1" documentos={[doc]} emiteProfesional={false} pagadoSinDocumentar={0} rol="PROFESIONAL" />);
    expect(screen.getByText(/Boleta electrónica folio 1001/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar boleta emitida/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
  });

  it('cobro directo: el profesional registra con honorarios por defecto; folio con letras no pasa', async () => {
    envolver(<DocumentosTributarios citaId="c1" documentos={[]} emiteProfesional pagadoSinDocumentar={20000} rol="PROFESIONAL" />);
    await userEvent.click(screen.getByRole('button', { name: /Registrar boleta emitida/ }));
    expect(screen.getByLabelText(/Tipo de documento/)).toHaveValue('BOLETA_HONORARIOS');
    await userEvent.type(screen.getByLabelText(/Folio/), '12ab');
    expect(screen.getByLabelText(/Folio/)).toHaveValue('12');
  });

  it('sin documentos y sin permiso o sin monto pendiente: no muestra la seccion', () => {
    const { container } = envolver(
      <DocumentosTributarios citaId="c1" documentos={[]} emiteProfesional={false} pagadoSinDocumentar={30000} rol="PROFESIONAL" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
