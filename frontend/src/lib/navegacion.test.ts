import { describe, expect, it } from 'vitest';

import { conSelectorEquipo, menuVisible, rutaPermitida } from './navegacion';

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

  it('la cuenta madre ve Equipo en Centro (una sola vez); GESTION en Modulos', () => {
    const todos = ['EQUIPO'] as const;
    const admin = menuVisible('admin', 'ADMIN', todos).filter((i) => i.etiqueta === 'Equipo');
    expect(admin.map((i) => i.grupo)).toEqual(['centro']);
    expect(
      menuVisible('admin', 'GESTION', todos)
        .filter((i) => i.etiqueta === 'Equipo')
        .map((i) => i.grupo),
    ).toEqual(['modulos']);
    expect(etiquetas(menuVisible('admin', 'ADMIN', []))).not.toContain('Equipo');
    expect(rutaPermitida('admin', 'ADMIN', '/admin/equipo')).toBe(true);
    expect(conSelectorEquipo('ADMIN')).toBe(false);
    expect(conSelectorEquipo('GESTION')).toBe(true);
  });

  it('oculta opciones que el rol activo no tiene', () => {
    const todos = ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'COBROS'] as const;
    const practicante = etiquetas(menuVisible('admin', 'PRACTICANTE', todos));
    expect(practicante).not.toContain('Configuración');
    expect(practicante).not.toContain('Cobros');
    expect(practicante).not.toContain('Match Terapéutico');
    expect(etiquetas(menuVisible('admin', 'GESTION', todos))).toContain('Cobros');
  });

  it('la seccion Centro es solo de la cuenta madre (ADMIN)', () => {
    const todos = ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'COBROS'] as const;
    expect(menuVisible('admin', 'ADMIN', todos).filter((i) => i.grupo === 'centro')).toHaveLength(3);
    for (const rol of ['GESTION', 'PROFESIONAL', 'PRACTICANTE'] as const) {
      expect(menuVisible('admin', rol, todos).filter((i) => i.grupo === 'centro')).toEqual([]);
    }
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
