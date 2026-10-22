'use client';

import { useState, type ReactNode } from 'react';

import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { formatoRut, pareceRut, rutValido } from '@/lib/formato';

const limpio = (texto: string) => texto.replace(/[^\dkK]/g, '').toUpperCase();

/**
 * Forma escrita -> como se muestra mientras se escribe: con puntos, guion y K
 * mayuscula. Acepta pegar "12345678-k", "12.345.678k" o "12 345 678 K". Con
 * `oCorreo`, un texto que no parece RUT (tiene @ o letras) queda tal cual.
 */
export function rutMientrasEscribe(texto: string, oCorreo = false): string {
  if (oCorreo && !pareceRut(texto) && !/^[\d.\s-]*$/.test(texto)) return texto;
  const c = limpio(texto).slice(0, 9);
  return c.length < 2 ? c : formatoRut(c);
}

/** Valor que viaja a la API: cuerpo y DV sin puntos ("12345678-K"). */
export function rutNormalizado(texto: string): string {
  const c = limpio(texto);
  return c.length < 2 ? c : `${c.slice(0, -1)}-${c.slice(-1)}`;
}

interface Props {
  label: ReactNode;
  value: string;
  onChange: (valor: string) => void;
  hint?: ReactNode;
  /** Error del formulario (p. ej. obligatorio o RUT ya registrado); el del DV lo pone el campo. */
  error?: string;
  required?: boolean;
  placeholder?: string;
  /** Login: el mismo campo acepta un correo; solo formatea y valida si parece RUT. */
  oCorreo?: boolean;
  autoComplete?: string;
}

/**
 * Campo unico de RUT (03b-4.1): formatea mientras se escribe, valida el
 * digito verificador en el momento (con 8 o mas caracteres, o al salir) y
 * muestra un check cuando es valido. El padre envia rutNormalizado(valor).
 */
export function CampoRut({ label, value, onChange, hint, error, required, placeholder = '12.345.678-9', oCorreo = false, autoComplete }: Props) {
  const [salio, setSalio] = useState(false);
  const esRut = oCorreo ? pareceRut(value) : value.trim() !== '';
  const completo = limpio(value).length >= 8;
  const valido = esRut && rutValido(value);
  const errorDv = esRut && (completo || salio) && !valido ? 'El RUT no es válido: revisa el dígito verificador.' : undefined;
  return (
    <Field label={label} hint={hint} error={error ?? errorDv} required={required}>
      {(p) => (
        <span className="relative block">
          <Input
            {...p}
            type="text"
            inputMode={oCorreo ? 'email' : 'text'}
            autoComplete={autoComplete ?? 'off'}
            placeholder={placeholder}
            value={value}
            maxLength={oCorreo ? 254 : 12}
            onChange={(e) => onChange(rutMientrasEscribe(e.target.value, oCorreo))}
            onBlur={() => setSalio(true)}
            className={valido ? 'pr-12' : ''}
          />
          {valido && <Icon name="check_circle" size={20} className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-accent-2-700" />}
        </span>
      )}
    </Field>
  );
}
