import { describe, expect, it, vi } from 'vitest';

const llamadas = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/api/cliente', () => {
  const anotar = (m: string) => (ruta: string, o: { params?: { path?: { id?: string } }; body?: { valor?: string } }) => {
    llamadas.push(`${m} ${o.params?.path?.id ?? ''} ${o.body?.valor ?? ''}`.trim());
    return {};
  };
  return { api: { POST: anotar('POST'), PATCH: anotar('PATCH'), DELETE: anotar('DELETE') }, datos: async (r: unknown) => r };
});

import { franja, franjasPorDefecto, guardarOpciones, validar, vacio } from './EditorOpciones';

const limites = { dias: [1, 2, 3, 4, 5], inicio: 540, fin: 1200 };
const opcion = (id: string, valor: string, etiqueta: string, orden: number) => ({
  id,
  preguntaId: 'q',
  valor,
  etiqueta,
  orden,
  activa: true,
  nota: null,
  criterio: null,
  objetivo: null,
  peso: 0,
  estricto: false,
  mensaje: null,
});

describe('Editor de opciones del match', () => {
  it('franjas por defecto se recortan al horario del centro', () => {
    expect(franjasPorDefecto(limites).map((b) => b.valor)).toEqual(['540-720', '720-900', '900-1140', '1140-1200']);
  });

  it('valida franjas fuera de horario, superpuestas y alternativas repetidas', () => {
    expect(validar('FRANJAS', [franja('Temprano', 480, 600)], limites)).toMatch(/dentro del horario/);
    expect(validar('FRANJAS', [franja('A', 540, 700), franja('B', 650, 800)], limites)).toMatch(/superponerse/);
    expect(validar('UNICA', [vacio('Sí'), vacio('sí')], limites)).toMatch(/mismo texto/);
    expect(validar('UNICA', [vacio('Sí'), vacio('No')], limites)).toBeUndefined();
  });

  it('guardar crea primero, elimina al final y reusa el dia que se quito y volvio a marcar', async () => {
    const pregunta = {
      id: 'q',
      tipo: 'DIAS' as const,
      opciones: [opcion('o1', '1', 'Lunes', 1), opcion('o2', '2', 'Martes', 2)],
    } as never;
    llamadas.length = 0;
    await guardarOpciones(pregunta, [vacio('Lunes', { valor: '1' }), vacio('Miércoles', { valor: '3' })]);
    expect(llamadas).toEqual(['POST q 3', 'DELETE o2']);
  });
});
