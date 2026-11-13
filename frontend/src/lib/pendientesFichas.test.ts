import { describe, expect, it } from 'vitest';

import { plazoEvolucion, sinEvolucionPorPaciente, type PendienteFicha } from './fichas';

const DIA = 86_400_000;
const ahora = Date.parse('2026-11-04T15:00:00Z');
const iso = (dias: number) => new Date(ahora + dias * DIA).toISOString();
const sesion = (paciente: string, dias: number, plazo = 30): PendienteFicha => ({
  profesional_id: 'p1',
  paciente_id: paciente,
  codigo: `C-${paciente}`,
  tipo: 'SIN_EVOLUCION',
  cita_id: `${paciente}${dias}`,
  fecha: iso(dias),
  vence: iso(dias + plazo),
  menor: false,
});

describe('Pendientes de las fichas (seguimiento y Por hacer)', () => {
  it('plazo de la evolucion: vencido, por vencer (7 dias o menos) o en plazo', () => {
    expect(plazoEvolucion(iso(-1), ahora)).toEqual({ texto: 'Plazo vencido', tono: 'vencido' });
    expect(plazoEvolucion(iso(0), ahora)).toEqual({ texto: 'Vence hoy', tono: 'pronto' });
    expect(plazoEvolucion(iso(1), ahora)).toEqual({ texto: 'Vence mañana', tono: 'pronto' });
    expect(plazoEvolucion(iso(7), ahora).tono).toBe('pronto');
    expect(plazoEvolucion(iso(18), ahora)).toEqual({ texto: 'Vence en 18 días', tono: 'plazo' });
  });

  it('agrupa por paciente, sesiones en orden y el plazo mas cercano primero; ignora otros tipos', () => {
    const lista: PendienteFicha[] = [sesion('b', -1), sesion('a', -8), sesion('a', -13), { ...sesion('c', 0), tipo: 'CONSENTIMIENTO', vence: null }];
    const grupos = sinEvolucionPorPaciente(lista);
    expect(grupos.map((g) => g.pacienteId)).toEqual(['a', 'b']);
    expect(grupos[0]!.sesiones.map((s) => s.cita_id)).toEqual(['a-13', 'a-8']);
  });
});
