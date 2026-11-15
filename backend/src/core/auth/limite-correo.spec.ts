import { LimitePorCorreo } from './limite-correo';

describe('LimitePorCorreo', () => {
  it('3 por hora por direccion, sin distinguir mayusculas ni espacios', () => {
    const l = new LimitePorCorreo(3, 3_600_000);
    expect(l.permitir('ana@test.cl', 0)).toBe(true);
    expect(l.permitir('ANA@test.cl ', 1)).toBe(true);
    expect(l.permitir('ana@test.cl', 2)).toBe(true);
    expect(l.permitir('ana@test.cl', 3)).toBe(false);
    expect(l.permitir('otra@test.cl', 3)).toBe(true);
  });

  it('se libera al pasar la ventana', () => {
    const l = new LimitePorCorreo(1, 1000);
    expect(l.permitir('a@test.cl', 0)).toBe(true);
    expect(l.permitir('a@test.cl', 999)).toBe(false);
    expect(l.permitir('a@test.cl', 1001)).toBe(true);
  });
});
