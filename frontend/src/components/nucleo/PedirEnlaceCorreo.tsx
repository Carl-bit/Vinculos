'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/errores';

import { ResultadoCuenta } from './ResultadoCuenta';

/**
 * Pide un enlace por correo (recuperar contraseña o acceso sin contraseña).
 * La API responde igual exista o no la cuenta: el texto final tampoco lo
 * revela.
 */
export function PedirEnlaceCorreo({
  pedir,
  boton,
  vence,
  volver,
}: {
  pedir: (email: string) => Promise<unknown>;
  boton: string;
  /** "1 hora", "15 minutos". */
  vence: string;
  volver: string;
}) {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const alerta = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const valor = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
      setError('Escribe el correo con el que te registraste en el centro.');
      return;
    }
    setError(undefined);
    setEnviando(true);
    try {
      await pedir(valor);
      setEnviado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <ResultadoCuenta
        icono="mark_email_read"
        titulo="Revisa tu correo."
        accion={
          <Link href={volver} className="flex min-h-10 items-center text-[13.5px] font-extrabold">
            Volver a iniciar sesión
          </Link>
        }
      >
        Si <strong className="text-text">{email.trim().toLowerCase()}</strong> tiene una cuenta en el centro, te llegará un enlace de un solo uso que vence en{' '}
        {vence}. Si no lo ves en unos minutos, revisa la carpeta de spam.
      </ResultadoCuenta>
    );
  }
  return (
    <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
      <Field label="Correo">
        {(p) => <Input {...p} type="email" autoComplete="email" placeholder="tu@correo.cl" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      {error && (
        <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={enviando} className="mt-1 w-full">
        {boton}
      </Button>
      <Link href={volver} className="flex min-h-10 items-center justify-center text-[13.5px] font-extrabold">
        Volver a iniciar sesión
      </Link>
    </form>
  );
}
