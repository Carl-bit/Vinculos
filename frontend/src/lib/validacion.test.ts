import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MENSAJE_CORREO, MENSAJE_TELEFONO, reglaCorreo, reglaTelefono, useValidacionCampos } from './validacion';

describe('reglas de formato (03b-4.1)', () => {
  it('telefono con codigo de pais, con o sin espacios; vacio pasa', () => {
    expect(reglaTelefono('+56 9 1234 5678')).toBeUndefined();
    expect(reglaTelefono('+56912345678')).toBeUndefined();
    expect(reglaTelefono('')).toBeUndefined();
    expect(reglaTelefono('912345678')).toBe(MENSAJE_TELEFONO);
  });

  it('correo con @ y dominio; obligatorio solo si se pide', () => {
    expect(reglaCorreo()('ana@centro.cl')).toBeUndefined();
    expect(reglaCorreo()('')).toBeUndefined();
    expect(reglaCorreo(true)('')).toBe('Escribe un correo.');
    expect(reglaCorreo()('ana@centro')).toBe(MENSAJE_CORREO);
  });
});

describe('useValidacionCampos', () => {
  it('marca al salir, limpia al escribir y valida todo al enviar', () => {
    const { result } = renderHook(() => useValidacionCampos({ email: reglaCorreo(), telefono: reglaTelefono }));
    act(() => result.current.alSalir('telefono', '123'));
    expect(result.current.errores.telefono).toBe(MENSAJE_TELEFONO);
    act(() => result.current.limpiar('telefono'));
    expect(result.current.errores.telefono).toBeUndefined();
    let ok = true;
    act(() => {
      ok = result.current.validarTodo({ email: 'x', telefono: '+56912345678' });
    });
    expect(ok).toBe(false);
    expect(result.current.errores).toEqual({ email: MENSAJE_CORREO, telefono: undefined });
  });
});
