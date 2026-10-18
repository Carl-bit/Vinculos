'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { CamposPassword, errorPassword } from '@/components/shared/CamposPassword';
import { TarjetaIngreso, TituloIngreso } from '@/components/shared/TarjetaIngreso';
import { Button } from '@/components/ui/Button';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

import { PedirEnlaceCorreo } from './PedirEnlaceCorreo';
import { ResultadoCuenta } from './ResultadoCuenta';

/**
 * Recuperar contraseña. Sin token: pide el enlace (1 hora, un solo uso).
 * Con token (enlace del correo): elige la contraseña nueva; las sesiones
 * abiertas se cierran en la API.
 */
export function RecuperarCuenta() {
  const parametros = useSearchParams();
  const token = parametros.get('token');
  const perfil = parametros.get('perfil') === 'equipo' ? 'equipo' : 'paciente';
  const ingreso = perfil === 'equipo' ? '/ingreso?perfil=equipo' : '/ingreso';

  return (
    <TarjetaIngreso perfil={perfil}>
      {token ? (
        <NuevaPassword token={token} ingreso={ingreso} />
      ) : (
        <>
          <TituloIngreso titulo="¿Olvidaste tu contraseña?" bajada="Escribe tu correo y te enviaremos un enlace para elegir una nueva." />
          <PedirEnlaceCorreo
            pedir={(email) => datos(api.POST('/api/auth/recuperacion', { body: { email } }))}
            boton="Enviar enlace"
            vence="1 hora"
            volver={ingreso}
          />
        </>
      )}
    </TarjetaIngreso>
  );
}

function NuevaPassword({ token, ingreso }: { token: string; ingreso: string }) {
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<{ nueva?: string; repetida?: string }>({});
  const [estado, setEstado] = useState<'listo' | 'vencido' | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const alerta = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const err = errorPassword(nueva, repetida);
    setErrores(err);
    if (err.nueva || err.repetida) return;
    setError(undefined);
    setEnviando(true);
    try {
      await datos(api.POST('/api/auth/recuperacion/confirmacion', { body: { token, password: nueva } }));
      setEstado('listo');
    } catch (er) {
      if (er instanceof ApiError && [400, 401, 404, 409].includes(er.status)) setEstado('vencido');
      else setError(er instanceof ApiError ? er.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (estado === 'listo') {
    return (
      <ResultadoCuenta
        icono="check_circle"
        titulo="Tu contraseña cambió."
        accion={
          <Link href={ingreso} className="flex min-h-10 items-center text-[13.5px] font-extrabold">
            Iniciar sesión
          </Link>
        }
      >
        Ya puedes entrar con tu contraseña nueva. Por seguridad cerramos las sesiones que tenías abiertas en otros equipos.
      </ResultadoCuenta>
    );
  }
  if (estado === 'vencido') {
    return (
      <ResultadoCuenta
        icono="link_off"
        titulo="Este enlace ya no sirve."
        accion={
          <Link href="/cuenta/recuperar" className="flex min-h-10 items-center text-[13.5px] font-extrabold">
            Pedir un enlace nuevo
          </Link>
        }
      >
        El enlace ya se usó o pasó más de 1 hora desde que lo pediste.
      </ResultadoCuenta>
    );
  }
  return (
    <>
      <TituloIngreso titulo="Elige tu contraseña nueva." />
      <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        <CamposPassword nueva={nueva} repetida={repetida} onNueva={setNueva} onRepetida={setRepetida} errores={errores} />
        {error && (
          <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={enviando} className="mt-1 w-full">
          Guardar contraseña
        </Button>
      </form>
    </>
  );
}
