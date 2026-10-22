'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { verificarSegundoFactor, type DesafioSegundoFactor, type SesionActiva } from '@/lib/sesion';

import { CodigosRespaldo } from './CodigosRespaldo';
import { PasoTotp } from './PasoTotp';
import { TituloIngreso } from './TarjetaIngreso';

const ESPERA_S = 60;

/**
 * Segundo paso del login (03b-4.1): codigo de 6 digitos enviado al correo,
 * o un codigo de respaldo. La primera vez muestra los 10 codigos de respaldo
 * antes de entrar. Con TOTP habilitado en la API (hoy apagado) delega en
 * PasoTotp. Lo usan el login, el enlace de acceso y la activacion.
 */
export function PasoSegundoFactor({
  desafio,
  onEntrar,
  onVolver,
}: {
  desafio: DesafioSegundoFactor;
  onEntrar: (s: SesionActiva) => void;
  onVolver: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [respaldo, setRespaldo] = useState(false);
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [espera, setEspera] = useState(ESPERA_S);
  const [entrada, setEntrada] = useState<{ sesion: SesionActiva; codigos: string[] }>();
  const alerta = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  if (desafio.metodo === 'TOTP') {
    return <PasoTotp desafio={desafio} onEntrar={onEntrar} onVolver={onVolver} />;
  }

  const valido = respaldo ? /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(codigo.trim()) : /^\d{6}$/.test(codigo);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    setError(undefined);
    setEnviando(true);
    try {
      const r = await verificarSegundoFactor(desafio.desafio, codigo.trim());
      if (!('accessToken' in r)) return;
      if (r.codigosRespaldo?.length) setEntrada({ sesion: r, codigos: r.codigosRespaldo });
      else onEntrar(r);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'El código no es válido o venció. Puedes pedir uno nuevo.'
          : err instanceof ApiError
            ? err.message
            : 'No pudimos conectar con el centro.',
      );
    } finally {
      setEnviando(false);
    }
  };

  const reenviar = async () => {
    setError(undefined);
    setAviso(undefined);
    const r = await api.POST('/api/auth/segundo-factor/codigo', { body: { desafio: desafio.desafio } });
    if (r.response.status === 204) {
      setAviso('Te enviamos un código nuevo. El anterior ya no sirve.');
      setCodigo('');
      setEspera(ESPERA_S);
    } else setError(r.response.status === 409 ? 'Espera un momento antes de pedir otro código.' : 'El ingreso venció. Vuelve a iniciar sesión.');
  };

  if (entrada) {
    return (
      <>
        <Eyebrow tone="team">Verificación en dos pasos activada</Eyebrow>
        <TituloIngreso titulo="Tus códigos de respaldo." />
        <CodigosRespaldo codigos={entrada.codigos} onListo={() => onEntrar(entrada.sesion)} />
      </>
    );
  }

  return (
    <>
      <Eyebrow tone="team">Verificación en dos pasos</Eyebrow>
      <TituloIngreso
        titulo={respaldo ? 'Usa un código de respaldo.' : 'Revisa tu correo.'}
        bajada={
          respaldo
            ? 'Escribe uno de los 10 códigos que guardaste al activar la verificación. Cada uno sirve una sola vez.'
            : `Te enviamos un código a tu correo${desafio.destino ? ` (${desafio.destino})` : ''}. Vence en 10 minutos.${
                desafio.enrolamiento ? ' Es tu primer ingreso con verificación en dos pasos: al terminar te daremos códigos de respaldo.' : ''
              }`
        }
      />
      <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        <Field label={respaldo ? 'Código de respaldo' : 'Código de verificación'} hint={respaldo ? 'Formato XXXXX-XXXXX.' : '6 dígitos.'}>
          {(p) => (
            <Input
              {...p}
              key={respaldo ? 'respaldo' : 'correo'}
              inputMode={respaldo ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={respaldo ? 11 : 6}
              value={codigo}
              onChange={(e) => setCodigo(respaldo ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-lg tracking-[0.3em]"
              // El codigo es lo unico que pide este paso: el foco va directo al campo.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          )}
        </Field>
        {aviso && (
          <p role="status" className="m-0 flex gap-2 text-[13.5px] font-bold text-accent-2-800">
            <Icon name="mark_email_read" size={18} />
            {aviso}
          </p>
        )}
        {error && (
          <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" variant="team" loading={enviando} disabled={!valido} className="mt-1 w-full">
          Verificar
        </Button>
        {!respaldo && (
          <Button variant="secondary" icon="mail" disabled={espera > 0} onClick={() => void reenviar()}>
            {espera > 0 ? `Reenviar código (${espera} s)` : 'Reenviar código'}
          </Button>
        )}
        <button
          type="button"
          onClick={() => {
            setRespaldo((r) => !r);
            setCodigo('');
            setError(undefined);
          }}
          className="min-h-10 cursor-pointer text-[13.5px] font-extrabold text-accent-700 underline underline-offset-2 hover:text-accent-800"
        >
          {respaldo ? 'Usar el código del correo' : '¿No te llega? Usa un código de respaldo'}
        </button>
        <Button variant="ghost" onClick={onVolver}>
          Volver
        </Button>
      </form>
    </>
  );
}
