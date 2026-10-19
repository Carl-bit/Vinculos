import { describe, expect, it } from 'vitest';

import { menuVisible } from './navegacion';

const etiquetas = (items: { etiqueta: string }[]) => items.map((i) => i.etiqueta);

describe('menuVisible', () => {
  it('oculta los modulos no contratados', () => {
    const items = etiquetas(menuVisible('admin', 'ADMIN', ['FICHAS', 'AGENDA']));
    expect(items).toContain('Fichas y Pacientes');
    expect(items).toContain('Agenda y Espacios');
    expect(items).not.toContain('Cobros');
    expect(items).not.toContain('Match Terapéutico');
    expect(items).toContain('Configuración');
  });

  it('oculta opciones que el rol activo no tiene', () => {
    const todos = ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'COBROS'] as const;
    const practicante = etiquetas(menuVisible('admin', 'PRACTICANTE', todos));
    expect(practicante).not.toContain('Configuración');
    expect(practicante).not.toContain('Cobros');
    expect(practicante).not.toContain('Match Terapéutico');
    expect(etiquetas(menuVisible('admin', 'GESTION', todos))).toContain('Cobros');
  });

  it('el portal no muestra opciones del backoffice', () => {
    const principal = (activos: Parameters<typeof menuVisible>[2]) => menuVisible('portal', 'PACIENTE', activos).filter((i) => i.grupo === 'principal');
    expect(etiquetas(principal(['AGENDA']))).toEqual(['Mi cuenta', 'Pedir una hora']);
    expect(etiquetas(principal([]))).toEqual(['Mi cuenta']);
  });

  it('la cuenta restringida del adolescente no ve pagos, documentos, consentimientos ni reseñas', () => {
    const todos = ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'COBROS'] as const;
    const plena = etiquetas(menuVisible('portal', 'PACIENTE', todos).filter((i) => i.grupo === 'secciones'));
    expect(plena).toEqual(['Resumen', 'Pagos', 'Documentos', 'Consentimientos', 'Avisos', 'Reseñas', 'Seguridad']);
    const restringida = etiquetas(menuVisible('portal', 'PACIENTE', todos, { restringida: true }).filter((i) => i.grupo === 'secciones'));
    expect(restringida).toEqual(['Resumen', 'Avisos', 'Seguridad']);
  });
});
