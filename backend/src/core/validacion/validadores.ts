/**
 * Validaciones de formato que la BD ya no puede hacer sobre columnas cifradas
 * (cifrado.md, "Validaciones movidas a DTOs"). La normalizacion del RUT es la
 * misma que usa el indice ciego (normalizarRut de common/crypto): un RUT que
 * pasa el DTO siempre produce el mismo rut_hmac.
 */
import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';

import { normalizarRut } from '../../common/crypto/cifrado';

/** Digito verificador modulo 11. */
export function dvRut(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}

export function rutValido(valor: unknown): boolean {
  if (typeof valor !== 'string') {
    return false;
  }
  let limpio: string;
  try {
    limpio = normalizarRut(valor);
  } catch {
    return false;
  }
  return dvRut(limpio.slice(0, -1)) === limpio.slice(-1);
}

/** RUT chileno con digito verificador. Se guarda normalizado (sin puntos ni guion). */
export function IsRut(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'isRut',
      target: objeto.constructor,
      propertyName: propiedad,
      options: { message: 'RUT invalido (formato o digito verificador)', ...opciones },
      validator: { validate: rutValido },
    });
}

/** Normaliza el RUT despues de validar (mismo formato que el indice ciego). */
export const NormalizarRut = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' && rutValido(value) ? normalizarRut(value) : value));

/** Telefono chileno: +56 seguido de 9 digitos (movil 9XXXXXXXX o fijo). */
export const TELEFONO_CL = /^\+56\d{9}$/;

/** Texto libre clinico: sin espacios a los extremos y no vacio. */
export const Recortar = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
