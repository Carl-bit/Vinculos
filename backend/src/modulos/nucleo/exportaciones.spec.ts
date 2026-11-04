import { notasSinMarcas, textoLegible } from './exportaciones.service';

describe('notasSinMarcas', () => {
  it('quita titulo, formato y cita; conserva listas, escalas y tareas', () => {
    const notas = [
      '# Seguimiento',
      '',
      '## Plan',
      '',
      'Refiere **menos** episodios, *hoy* y __ayer__.',
      '',
      '> Dijo que duerme mejor',
      '',
      '- Autorregistro',
      '1. Respiración',
      '',
      'Escala · Ánimo: 6/10',
      'Tarea · Completar autorregistro',
    ].join('\n');
    expect(notasSinMarcas(notas)).toBe(
      [
        'Seguimiento',
        '',
        'Plan',
        '',
        'Refiere menos episodios, hoy y ayer.',
        '',
        'Dijo que duerme mejor',
        '',
        '- Autorregistro',
        '1. Respiración',
        '',
        'Escala · Ánimo: 6/10',
        'Tarea · Completar autorregistro',
      ].join('\n'),
    );
  });

  it('no toca asteriscos ni guiones bajos que son parte del texto clinico', () => {
    for (const texto of ['Dosis 2*3 y 4*5', 'archivo_nombre__final__v2', '#sin espacio', 'Un * suelto']) {
      expect(notasSinMarcas(texto)).toBe(texto);
    }
  });

  it('textoLegible entrega las evoluciones sin marcas', () => {
    const texto = textoLegible({ evoluciones: [{ created_at: '2026-10-01T12:00:00.000Z', autor_nombre: 'Ps. Demo', notas: '# Control\n\n**Estable**' }] });
    expect(texto).toContain('Control\n\nEstable');
    expect(texto).not.toContain('**');
  });
});
