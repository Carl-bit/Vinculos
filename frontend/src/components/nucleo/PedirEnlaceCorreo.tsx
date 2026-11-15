'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/errores';

import { reglaCorreo } from '@/lib/validacion';
import { ResultadoCuenta } from './ResultadoCuenta';

/**
 * Pide un enlace por correo (recuperar contraseña o acceso sin contraseña).
 * La API responde igual y en el mismo tiempo exista o no la cuenta, y siempre
 * envia un correo (el enlace, o el aviso de que no hay cuenta con esa
 * direccion): el texto final no revela cual. El boton queda bloqueado
 * mientras la API responde.
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
          <>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setEnviado(false);
                setEmail('');
              }}
            >
              Probar con otro correo
            </Button>
            <Link href={volver} className="flex min-h-10 items-center text-[13.5px] font-extrabold">
              Volver a iniciar sesión
            </Link>
          </>
        }
      >
        Enviamos un correo a <strong className="text-text">{email.trim().toLowerCase()}</strong>. Si esa dirección tiene una cuenta en el centro, trae un enlace de un
        solo uso que vence en {vence}; si no, te explica qué hacer. Si no lo ves en 5 minutos, revisa la carpeta de spam o prueba con el correo que registraste en el
        centro.
      </ResultadoCuenta>
    );
  }
  return (
    <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
      <Field label="Correo">
        {(p) => (
          <Input
            {...p}
            type="email"
            autoComplete="email"
            placeholder="tu@correo.cl"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
            onBlur={() => setError(reglaCorreo()(email))}
          />
        )}
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
