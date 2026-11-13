import { describe, expect, it } from 'vitest';

import { aplicarFormato, bloquesDeTexto, separarNotas, textoPlano, trozosDeTexto, unirNotas } from './notasEvolucion';

describe('notas de la evolucion', () => {
  const partes = {
    titulo: 'Seguimiento',
    cuerpo: 'Refiere **menos** ansiedad.\n\nAcordamos continuar.',
    escalas: [{ nombre: 'Ánimo', valor: 6 }],
    tareas: ['Completar autorregistro'],
  };

  it('une y separa sin perder nada', () => {
    expect(separarNotas(unirNotas(partes))).toEqual(partes);
  });

  it('una nota antigua, sin titulo ni escalas, queda como cuerpo', () => {
    expect(separarNotas('Evolucion demo (texto ficticio).')).toEqual({ titulo: '', cuerpo: 'Evolucion demo (texto ficticio).', escalas: [], tareas: [] });
  });

  it('aplica formato a la seleccion y a las lineas', () => {
    expect(aplicarFormato('hola mundo', 5, 10, 'negrita')).toEqual({ texto: 'hola **mundo**', inicio: 7, fin: 12 });
    expect(aplicarFormato('uno\ndos\ntres', 0, 7, 'numerada').texto).toBe('1. uno\n2. dos\ntres');
    expect(aplicarFormato('uno\ndos', 5, 5, 'lista').texto).toBe('uno\n- dos');
    expect(aplicarFormato('', 0, 0, 'cita').texto).toBe('> ');
  });

  it('interpreta bloques y estilos', () => {
    expect(bloquesDeTexto('## Plan\nsigue\n\n- a\n- b\n\n1. x\n\n> cita')).toEqual([
      { tipo: 'titulo', texto: 'Plan' },
      { tipo: 'parrafo', texto: 'sigue' },
      { tipo: 'lista', items: ['a', 'b'] },
      { tipo: 'numerada', items: ['x'] },
      { tipo: 'cita', texto: 'cita' },
    ]);
    expect(trozosDeTexto('a **b** *c* __d__')).toEqual([
      { texto: 'a ' },
      { texto: 'b', estilo: 'negrita' },
      { texto: ' ' },
      { texto: 'c', estilo: 'cursiva' },
      { texto: ' ' },
      { texto: 'd', estilo: 'subrayado' },
    ]);
  });

  it('el extracto no muestra marcas, titulo ni escalas', () => {
    expect(textoPlano(unirNotas(partes))).toBe('Refiere menos ansiedad. Acordamos continuar.');
  });
});
