'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { TarjetaIngreso, TituloIngreso } from '@/components/shared/TarjetaIngreso';
import { Button } from '@/components/ui/Button';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

import { ResultadoCuenta } from './ResultadoCuenta';

/** Confirmar el correo nuevo (C-9). El token se usa al presionar el boton (un escaner de correo no lo consume). */
export function ConfirmarCorreo() {
  const token = useSearchParams().get('token') ?? '';
  const [estado, setEstado] = useState<'listo' | 'vencido' | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    setEnviando(true);
    setError(undefined);
    try {
      await datos(api.POST('/api/auth/correo/verificacion', { body: { token } }));
      setEstado('listo');
    } catch (e) {
      if (e instanceof ApiError && [400, 401, 404, 409].includes(e.status)) setEstado('vencido');
      else setError(e instanceof ApiError ? e.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const ir = (
    <Link href="/portal" className="flex min-h-10 items-center text-[13.5px] font-extrabold">
      Ir a mi cuenta
    </Link>
  );

  return (
    <TarjetaIngreso perfil="paciente">
      {estado === 'listo' ? (
        <ResultadoCuenta icono="mark_email_read" titulo="Tu correo quedó actualizado." accion={ir}>
          Desde ahora los avisos y enlaces del centro llegarán a este correo. También lo usas para iniciar sesión.
        </ResultadoCuenta>
      ) : estado === 'vencido' || !token ? (
        <ResultadoCuenta icono="link_off" titulo="Este enlace ya no sirve." accion={ir}>
          El enlace ya se usó o pasaron más de 24 horas. Puedes volver a cambiar tu correo desde Mis datos.
        </ResultadoCuenta>
      ) : (
        <>
          <TituloIngreso
            titulo="Confirma tu correo nuevo."
            bajada="Al confirmar, este pasa a ser el correo de tu cuenta y el anterior deja de recibir avisos."
          />
          {error && (
            <p role="alert" className="m-0 mb-4 text-[13.5px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <Button size="lg" icon="check" loading={enviando} onClick={() => void confirmar()} className="w-full">
            Confirmar mi correo
          </Button>
        </>
      )}
    </TarjetaIngreso>
  );
}
