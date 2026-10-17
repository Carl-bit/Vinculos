import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MIN = 60_000;
const tokens = (n: number) => ({ accessToken: `t${n}`, expiraEn: 900, inactividadMinutos: 30, rol: 'ADMIN', roles: ['ADMIN'] });

/** Modulo nuevo por test (el estado de sesion vive en el modulo). */
async function cargar() {
  vi.resetModules();
  return import('./sesion');
}

describe('sesion: cierre por inactividad (03b)', () => {
  let llamadas: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    llamadas = [];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const accion = url.replace('/sesion/', '');
        llamadas.push(accion);
        if (accion === 'logout') return new Response(null, { status: 204 });
        return new Response(JSON.stringify(tokens(++n)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sin actividad: a los 30 minutos cierra la sesion (logout) con motivo inactividad, sin renovarla', async () => {
    const s = await cargar();
    await s.iniciarSesion({ email: 'a@b.cl', password: 'x' });
    expect(s.estadoSesion().tipo).toBe('activa');
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(s.estadoSesion().tipo).toBe('activa');
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(s.estadoSesion()).toEqual({ tipo: 'anonima', motivo: 'inactividad' });
    expect(llamadas).toContain('logout');
    // Renovo a los 14 y 28 minutos (dentro del plazo); cerrada, no renueva mas.
    expect(llamadas.filter((a) => a === 'refresh')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(llamadas.filter((a) => a === 'refresh')).toHaveLength(2);
  });

  it('con actividad sigue abierta y renueva; la actividad de otra pestaña tambien cuenta', async () => {
    const s = await cargar();
    await s.iniciarSesion({ email: 'a@b.cl', password: 'x' });
    await vi.advanceTimersByTimeAsync(20 * MIN);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    await vi.advanceTimersByTimeAsync(25 * MIN);
    expect(s.estadoSesion().tipo).toBe('activa');
    // Otra pestaña escribe su marca de actividad.
    localStorage.setItem('vinculos_actividad', String(Date.now()));
    await vi.advanceTimersByTimeAsync(25 * MIN);
    expect(s.estadoSesion().tipo).toBe('activa');
    expect(llamadas).not.toContain('logout');
    await vi.advanceTimersByTimeAsync(6 * MIN);
    expect(s.estadoSesion()).toEqual({ tipo: 'anonima', motivo: 'inactividad' });
  });

  it('salir en otra pestaña cierra esta (evento storage)', async () => {
    const s = await cargar();
    await s.iniciarSesion({ email: 'a@b.cl', password: 'x' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'vinculos_salida', newValue: String(Date.now()) }));
    expect(s.estadoSesion()).toEqual({ tipo: 'anonima' });
  });
});
