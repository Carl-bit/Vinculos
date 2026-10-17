'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Casilla } from '@/components/ui/Casilla';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

const TELEFONO = /^\+56\d{9}$/;

/**
 * Lista de espera publica (03b), sin cuenta: nombre, correo, telefono
 * opcional y la politica de datos. Se confirma con el enlace del correo
 * (24 horas); despues llegan avisos cuando el profesional tenga horas nuevas
 * o se libere una, cada uno con su enlace para salir de la lista. La respuesta
 * es siempre la misma (no revela si el correo ya estaba inscrito).
 */
export function InscripcionListaEspera({
  profesionalId,
  nombreProfesional,
  politicaDatos,
}: {
  profesionalId: string;
  nombreProfesional: string;
  politicaDatos: { id: string; version: number };
}) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [sitioWeb, setSitioWeb] = useState('');
  const [errores, setErrores] = useState<{ nombre?: string; email?: string; telefono?: string; acepta?: string }>({});
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const aviso = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enviado) aviso.current?.focus();
  }, [enviado]);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: typeof errores = {};
    if (!nombre.trim()) e.nombre = 'Escribe tu nombre.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Escribe un correo válido: ahí llegan los avisos.';
    if (telefono && !TELEFONO.test(telefono.replace(/\s/g, ''))) e.telefono = 'Formato +56 9 1234 5678.';
    if (!acepta) e.acepta = 'Para anotarte debes aceptar la política de datos.';
    setErrores(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    setError(undefined);
    try {
      await datos(
        api.POST('/api/publico/lista-espera', {
          body: {
            profesionalId,
            nombre: nombre.trim(),
            email: email.trim(),
            telefono: telefono.trim() ? telefono.replace(/\s/g, '') : undefined,
            politicaId: politicaDatos.id,
            sitioWeb: sitioWeb || undefined,
          },
        }),
      );
      setEnviado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos anotarte. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div ref={aviso} tabIndex={-1} role="status" className="entrada flex flex-col gap-2 outline-none">
        <p className="m-0 flex items-center gap-2.5 text-base font-extrabold">
          <Icon name="mark_email_read" size={22} className="text-accent-2-700" />
          Revisa tu correo para confirmar
        </p>
        <p className="m-0 max-w-[56ch] text-[13.5px] font-semibold text-pretty text-neutral-800">
          Enviamos un enlace a <strong className="text-text">{email.trim()}</strong>. Ábrelo dentro de 24 horas para quedar en la lista de espera de{' '}
          {nombreProfesional}. Si no lo ves, revisa la carpeta de spam.
        </p>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void enviar(e)} noValidate aria-label={`Lista de espera de ${nombreProfesional}`}>
      {error && (
        <p
          role="alert"
          className="m-0 flex gap-2.5 rounded-[18px] border border-accent-500 bg-accent-200 px-[17px] py-[15px] text-sm font-bold text-accent-900"
        >
          <Icon name="error" size={19} />
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tu nombre" required error={errores.nombre}>
          {(p) => <Input {...p} autoComplete="name" value={nombre} onChange={(ev) => setNombre(ev.target.value)} />}
        </Field>
        <Field label="Correo" required error={errores.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(ev) => setEmail(ev.target.value)} />}
        </Field>
        <Field label="Teléfono" hint="Opcional." error={errores.telefono}>
          {(p) => <Input {...p} type="tel" autoComplete="tel" placeholder="+56 9 1234 5678" value={telefono} onChange={(ev) => setTelefono(ev.target.value)} />}
        </Field>
      </div>
      <Casilla checked={acepta} onChange={setAcepta} error={errores.acepta}>
        Leí y acepto la{' '}
        <Link href="/politicas/POLITICA_DATOS" target="_blank" className="font-extrabold underline underline-offset-2">
          política de datos personales
        </Link>{' '}
        (versión {politicaDatos.version}). Solo usamos estos datos para avisarte de horas disponibles.
      </Casilla>
      {/* Trampa para bots: invisible para personas y lectores de pantalla. */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Sitio web
          <input tabIndex={-1} autoComplete="off" value={sitioWeb} onChange={(ev) => setSitioWeb(ev.target.value)} />
        </label>
      </div>
      <div>
        <Button type="submit" variant="primary" icon="notifications" loading={enviando}>
          Avisarme cuando haya horas
        </Button>
      </div>
    </form>
  );
}
