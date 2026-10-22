'use client';

import QRCode from 'qrcode';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field, Input } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { verificarTotp, type DesafioSegundoFactor, type SesionActiva } from '@/lib/sesion';

import { TituloIngreso } from './TarjetaIngreso';

/**
 * 03b-4.1: apagado (TOTP_HABILITADO en la API); solo se muestra si la API
 * responde metodo TOTP. Segundo paso del login (TOTP; MASTER.md
 * "Login, segundo paso TOTP"). En el enrolamiento muestra el codigo QR y la
 * clave para agregar la cuenta a la app de autenticacion. Lo usan el login,
 * el enlace de acceso y la activacion por invitacion.
 */
export function PasoTotp({ desafio, onEntrar, onVolver }: { desafio: DesafioSegundoFactor; onEntrar: (s: SesionActiva) => void; onVolver: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [enrolamiento, setEnrolamiento] = useState<{ secreto: string; qr?: string }>();
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const alerta = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!desafio.enrolamiento) return;
    let vigente = true;
    void datos(api.POST('/api/auth/totp/enrolamiento', { body: { desafio: desafio.desafio } }))
      .then(async (r) => {
        const qr = await QRCode.toDataURL(r.uri, { margin: 1, width: 196, color: { dark: '#201e1d', light: '#fffcf6' } }).catch(() => undefined);
        if (vigente) setEnrolamiento({ secreto: r.secreto, qr });
      })
      .catch(() => vigente && setError('No pudimos preparar la verificación en dos pasos. Vuelve a ingresar.'));
    return () => {
      vigente = false;
    };
  }, [desafio]);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo.trim())) {
      setError('El código tiene 6 dígitos.');
      return;
    }
    setError(undefined);
    setEnviando(true);
    try {
      const r = await verificarTotp(desafio.desafio, codigo.trim());
      if ('accessToken' in r) onEntrar(r);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'El código no es válido o ya venció. Escribe el que muestra ahora tu app.'
          : err instanceof ApiError
            ? err.message
            : 'No pudimos conectar con el centro.',
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Eyebrow tone="team">Verificación en dos pasos</Eyebrow>
      <TituloIngreso
        titulo="Ingresa tu código."
        bajada={
          desafio.enrolamiento
            ? 'Tu cuenta requiere verificación en dos pasos. Escanea el código con tu app de autenticación (o escribe la clave) y luego ingresa el código de 6 dígitos que muestra.'
            : 'Abre tu app de autenticación y escribe el código de 6 dígitos.'
        }
      />
      {enrolamiento && (
        <div className="mb-5 flex flex-col items-center gap-3">
          {enrolamiento.qr && (
            // eslint-disable-next-line @next/next/no-img-element -- QR generado en el navegador (data URL), sin red.
            <img
              src={enrolamiento.qr}
              alt="Código QR para agregar la cuenta a tu app de autenticación"
              width={196}
              height={196}
              className="rounded-[16px] border border-divider"
            />
          )}
          <p className="m-0 w-full rounded-lg border border-divider bg-bg px-4 py-3 text-center font-mono text-sm font-bold tracking-wider break-all select-all">
            {enrolamiento.secreto}
          </p>
        </div>
      )}
      <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        <Field label="Código de verificación">
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              // El codigo es lo unico que pide este paso: el foco va directo al campo.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          )}
        </Field>
        {error && (
          <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" variant="team" loading={enviando} className="mt-1 w-full">
          Verificar
        </Button>
        <Button variant="ghost" onClick={onVolver}>
          Volver
        </Button>
      </form>
    </>
  );
}
