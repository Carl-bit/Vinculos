'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { PasoSegundoFactor } from '@/components/shared/PasoSegundoFactor';
import { TarjetaIngreso, TituloIngreso } from '@/components/shared/TarjetaIngreso';
import { Button } from '@/components/ui/Button';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { inicioDeRol } from '@/lib/roles';
import { usarEnlaceAcceso, type DesafioSegundoFactor, type SesionActiva } from '@/lib/sesion';

import { PedirEnlaceCorreo } from './PedirEnlaceCorreo';
import { ResultadoCuenta } from './ResultadoCuenta';

/**
 * Entrar sin contraseña (C-6, pacientes y adultos responsables). Sin token:
 * pide el enlace (15 minutos). Con token: se usa recien al presionar
 * "Entrar" (un escaner de correo no lo consume).
 */
export function EnlaceAcceso() {
  const token = useSearchParams().get('token');
  return (
    <TarjetaIngreso perfil="paciente">
      {token ? (
        <UsarEnlace token={token} />
      ) : (
        <>
          <TituloIngreso
            titulo="Entra sin contraseña."
            bajada="Te enviamos un enlace de un solo uso al correo registrado en el centro. Sirve para pacientes y adultos responsables."
          />
          <PedirEnlaceCorreo
            pedir={(email) => datos(api.POST('/api/auth/enlace-acceso', { body: { email } }))}
            boton="Enviar enlace de acceso"
            vence="15 minutos"
            volver="/ingreso"
          />
        </>
      )}
    </TarjetaIngreso>
  );
}

function UsarEnlace({ token }: { token: string }) {
  const router = useRouter();
  const [desafio, setDesafio] = useState<DesafioSegundoFactor>();
  const [vencido, setVencido] = useState(false);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const entrar = (s: SesionActiva) => router.replace(inicioDeRol(s.rol));

  const usar = async () => {
    setEnviando(true);
    setError(undefined);
    try {
      const r = await usarEnlaceAcceso(token);
      if ('accessToken' in r) entrar(r);
      else setDesafio(r);
    } catch (e) {
      if (e instanceof ApiError && [400, 401, 404, 409].includes(e.status)) setVencido(true);
      else setError(e instanceof ApiError ? e.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (desafio) return <PasoSegundoFactor desafio={desafio} onEntrar={entrar} onVolver={() => router.replace('/ingreso')} />;
  if (vencido) {
    return (
      <ResultadoCuenta
        icono="link_off"
        titulo="Este enlace ya no sirve."
        accion={
          <Link href="/cuenta/acceso" className="flex min-h-10 items-center text-[13.5px] font-extrabold">
            Pedir un enlace nuevo
          </Link>
        }
      >
        Los enlaces de acceso sirven una sola vez y vencen a los 15 minutos.
      </ResultadoCuenta>
    );
  }
  return (
    <>
      <TituloIngreso titulo="Tu enlace está listo." bajada="Presiona el botón para entrar a tu cuenta. El enlace sirve una sola vez." />
      {error && (
        <p role="alert" className="m-0 mb-4 text-[13.5px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <Button size="lg" icon="login" loading={enviando} onClick={() => void usar()} className="w-full">
        Entrar a mi cuenta
      </Button>
    </>
  );
}
