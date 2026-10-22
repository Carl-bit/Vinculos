'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { CamposPassword, errorPassword } from '@/components/shared/CamposPassword';
import { PasoSegundoFactor } from '@/components/shared/PasoSegundoFactor';
import { TarjetaIngreso, TituloIngreso } from '@/components/shared/TarjetaIngreso';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/errores';
import { inicioDeRol } from '@/lib/roles';
import { activarCuenta, type DesafioSegundoFactor, type SesionActiva } from '@/lib/sesion';

import { ResultadoCuenta } from './ResultadoCuenta';

/**
 * Activar una invitacion (equipo, paciente o adulto responsable): elige la
 * contraseña y entra. La cuenta del paciente queda vinculada al registro que
 * ya tiene en el centro (lo hace la API). Roles clinicos: sigue el
 * enrolamiento TOTP.
 */
export function ActivarCuenta() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<{ nueva?: string; repetida?: string }>({});
  const [desafio, setDesafio] = useState<DesafioSegundoFactor>();
  const [vencido, setVencido] = useState(false);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const alerta = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);
  const entrar = (s: SesionActiva) => router.replace(inicioDeRol(s.rol));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const err = errorPassword(nueva, repetida);
    setErrores(err);
    if (err.nueva || err.repetida) return;
    setError(undefined);
    setEnviando(true);
    try {
      const r = await activarCuenta(token, nueva);
      if ('accessToken' in r) entrar(r);
      else setDesafio(r);
    } catch (er) {
      if (er instanceof ApiError && [401, 404, 409].includes(er.status)) setVencido(true);
      else setError(er instanceof ApiError ? er.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <TarjetaIngreso perfil="paciente">
      {desafio ? (
        <PasoSegundoFactor desafio={desafio} onEntrar={entrar} onVolver={() => router.replace('/ingreso?perfil=equipo')} />
      ) : !token ? (
        <ResultadoCuenta
          icono="link"
          titulo="Enlace incompleto."
          accion={
            <Link href="/ingreso" className="flex min-h-10 items-center text-[13.5px] font-extrabold">
              Ir a iniciar sesión
            </Link>
          }
        >
          Abre el enlace completo de la invitación que te enviamos al correo.
        </ResultadoCuenta>
      ) : vencido ? (
        <ResultadoCuenta
          icono="link_off"
          titulo="Esta invitación ya no sirve."
          accion={
            <Link href="/ingreso" className="flex min-h-10 items-center text-[13.5px] font-extrabold">
              Ir a iniciar sesión
            </Link>
          }
        >
          La invitación ya se usó o venció. Si ya elegiste tu contraseña, inicia sesión. Si no, pide al centro que te envíe una invitación nueva.
        </ResultadoCuenta>
      ) : (
        <>
          <TituloIngreso
            titulo="Activa tu cuenta."
            bajada="Elige una contraseña para entrar. Tu cuenta queda vinculada a tus datos en el centro: no necesitas registrarte de nuevo."
          />
          <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
            <CamposPassword nueva={nueva} repetida={repetida} onNueva={setNueva} onRepetida={setRepetida} errores={errores} etiqueta="Contraseña" />
            {error && (
              <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" loading={enviando} className="mt-1 w-full">
              Activar y entrar
            </Button>
          </form>
        </>
      )}
    </TarjetaIngreso>
  );
}
