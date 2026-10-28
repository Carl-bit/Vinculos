import { useState } from 'react';

/**
 * 03b-4.1: validacion de formato al salir del campo (no al enviar). El error
 * aparece al dejar el campo y se limpia al volver a escribir; al enviar se
 * revisa todo igual (la API valida de nuevo con sus DTOs).
 */
export type Regla = (valor: string) => string | undefined;

const telefonoApi = (t: string) => t.replace(/[\s()-]/g, '');

export const MENSAJE_TELEFONO = 'Escribe el teléfono con código de país: +56 9 1234 5678.';
export const MENSAJE_CORREO = 'Revisa el correo: falta la @ o el dominio.';

/** Correo con @ y dominio; vacio pasa salvo que sea obligatorio. */
export const reglaCorreo =
  (obligatorio = false): Regla =>
  (v) =>
    !v.trim() ? (obligatorio ? 'Escribe un correo.' : undefined) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : MENSAJE_CORREO;

/** Telefono chileno con codigo de pais (+56 y 9 digitos); vacio pasa. */
export const reglaTelefono: Regla = (v) => (!v.trim() || /^\+56\d{9}$/.test(telefonoApi(v)) ? undefined : MENSAJE_TELEFONO);

export const reglaObligatorio =
  (mensaje: string): Regla =>
  (v) =>
    v.trim() ? undefined : mensaje;

export function useValidacionCampos<K extends string>(reglas: Record<K, Regla>) {
  const [errores, setErrores] = useState<Partial<Record<K, string>>>({});
  /** onBlur del campo k. */
  const alSalir = (k: K, valor: string) => setErrores((e) => ({ ...e, [k]: reglas[k](valor) }));
  /** Al escribir: el error del campo desaparece hasta la proxima salida. */
  const limpiar = (k: K) => setErrores((e) => (e[k] ? { ...e, [k]: undefined } : e));
  /** Al enviar: revisa todos los campos con regla y dice si se puede seguir. */
  const validarTodo = (valores: Record<K, string>): boolean => {
    const nuevos = Object.fromEntries((Object.keys(reglas) as K[]).map((k) => [k, reglas[k](valores[k])])) as Partial<Record<K, string>>;
    setErrores(nuevos);
    return Object.values(nuevos).every((e) => !e);
  };
  return { errores, alSalir, limpiar, validarTodo };
}
