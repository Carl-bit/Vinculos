import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { BorradorVista, EvolucionVista } from '@/lib/fichas';
import type { CitaVista } from '@/lib/panel';

import { armarPilas, FichaClinicaTimeline } from './FichaClinicaTimeline';

const evolucion = (id: string, createdAt: string, extra: Partial<EvolucionVista> = {}) =>
  ({
    id,
    createdAt,
    notas: `# Título ${id}\n\nTexto **${id}**.`,
    nivelRiesgo: 'NINGUNO',
    corrigeAId: null,
    citaId: null,
    tipoSesion: { id: 't', nombre: 'Sesión individual' },
    ...extra,
  }) as unknown as EvolucionVista;
const cita = (id: string, inicio: string) => ({ id, inicio, fin: inicio, estado: 'CONFIRMADA' }) as unknown as CitaVista;
const borrador = { id: 'b', contenido: 'Sin título todavía', actualizadoEn: '2026-10-30T12:00:00Z' } as unknown as BorradorVista;

describe('FichaClinicaTimeline', () => {
  it('la evolucion elegida se abre sobre las pilas', async () => {
    const e = evolucion('a', '2026-10-30T12:00:00Z', { copiaAutoria: { nombre: 'Ps. Demo' }, intervenciones: [] } as unknown as Partial<EvolucionVista>);
    render(
      <FichaClinicaTimeline
        evoluciones={[e]}
        borradores={[]}
        citas={[]}
        miId={undefined}
        onCorregir={vi.fn()}
        onContinuar={vi.fn()}
        pila={undefined}
        onPila={vi.fn()}
        editorAbierto={false}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Título a/ }));
    const lectura = screen.getByRole('article', { name: 'Título a' });
    expect(lectura.compareDocumentPosition(screen.getByTestId('pila')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('armarPilas', () => {
  it('agrupa por mes de la sesion, numera las sesiones y pone los borradores primero', () => {
    const citas = [cita('c1', '2026-09-15T14:00:00Z'), cita('c2', '2026-10-13T14:00:00Z')];
    const pilas = armarPilas(
      [evolucion('a', '2026-10-30T12:00:00Z', { citaId: 'c1' }), evolucion('z', '2026-10-30T13:00:00Z', { citaId: 'c2' })],
      [borrador],
      citas,
      'todas',
      Date.parse('2026-10-31T12:00:00Z'),
    );
    expect(pilas.map((p) => p.titulo)).toEqual(['Borradores', 'Octubre 2026', 'Septiembre 2026']);
    expect(pilas[1]!.tarjetas[0]).toMatchObject({ sesion: 'Sesión 2', titulo: 'Título z', extracto: 'Texto z.', estado: 'Confirmada' });
    expect(pilas[2]!.tarjetas[0]).toMatchObject({ sesion: 'Sesión 1' });
  });

  it('marca correcciones y filtra sin mostrar borradores', () => {
    const original = evolucion('o', '2026-10-01T12:00:00Z');
    const correccion = evolucion('c', '2026-10-02T12:00:00Z', { corrigeAId: 'o' });
    const otra = evolucion('x', '2026-10-03T12:00:00Z', { nivelRiesgo: 'BAJO' });
    const estados = armarPilas([original, correccion, otra], [borrador], [], 'corregidas');
    expect(estados.flatMap((p) => p.tarjetas.map((t) => [t.id, t.estado]))).toEqual([
      ['c', 'Corrección'],
      ['o', 'Corregida'],
    ]);
    expect(armarPilas([original, otra], [borrador], [], 'riesgo').flatMap((p) => p.tarjetas.map((t) => t.id))).toEqual(['x']);
  });
});
