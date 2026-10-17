'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api/cliente';
import type { Icono } from '@/lib/iconos';

type Vista = 'inicio' | 'nuevo' | 'paciente';

/**
 * Pedir hora (diseño "Paciente - Pedir Hora", vista 1). Primera vez: match o
 * equipo. Ya soy paciente: solo el correo y siempre la misma respuesta; nunca
 * muestra profesional ni horas sin sesion (C-6).
 */
export function InicioPedirHora({ match }: { match: boolean }) {
  const [vista, setVista] = useState<Vista>('inicio');
  const titulo = useRef<HTMLHeadingElement>(null);
  const montado = useRef(false);
  useEffect(() => {
    if (montado.current) titulo.current?.focus();
    montado.current = true;
  }, [vista]);

  if (vista === 'paciente') return <YaSoyPaciente titulo={titulo} onVolver={() => setVista('inicio')} />;

  return (
    <div key={vista} className="entrada max-w-[760px] py-[clamp(32px,6vw,80px)]">
      <Eyebrow>Pedir una hora</Eyebrow>
      <h1
        ref={titulo}
        tabIndex={-1}
        className="m-0 mb-[18px] text-[clamp(34px,5vw,56px)] leading-none font-black tracking-[-0.035em] text-balance outline-none"
      >
        {vista === 'inicio' ? '¿Es tu primera vez pidiendo una hora en el centro?' : '¿Cómo quieres elegir a tu profesional?'}
      </h1>
      <p className="m-0 mb-9 max-w-[52ch] text-[17px] leading-relaxed text-pretty text-neutral-700">
        {vista === 'inicio'
          ? 'Así sabemos si te ayudamos a encontrar profesional o si te enviamos directo a tu cuenta.'
          : 'Puedes responder unas preguntas y te sugerimos a alguien, o revisar el equipo y elegir tú.'}
      </p>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
        {vista === 'inicio' ? (
          <>
            <Opcion
              icono="waving_hand"
              titulo="Sí, es mi primera vez"
              texto="Te ayudamos a elegir profesional y horario, sin crear una cuenta antes."
              destacada
              onClick={() => setVista('nuevo')}
            />
            <Opcion
              icono="event_repeat"
              titulo="No, ya soy paciente del centro"
              texto="Te enviamos un enlace al correo para entrar a tu cuenta y pedir la hora ahí."
              onClick={() => setVista('paciente')}
            />
          </>
        ) : (
          <>
            {match && (
              <Opcion
                icono="join"
                titulo="Hacer el match terapéutico"
                texto="Unas preguntas cortas y te sugerimos a alguien del equipo. No guardamos tus respuestas."
                destacada
                href="/match"
              />
            )}
            <Opcion
              icono="group"
              titulo="Elegir del equipo"
              texto="Revisa formación, enfoque y tarifas, y pide hora con quien prefieras."
              destacada={!match}
              href="/equipo"
            />
          </>
        )}
      </div>
      {vista === 'nuevo' && (
        <Button variant="ghost" icon="arrow_back" className="mt-6" onClick={() => setVista('inicio')}>
          Volver
        </Button>
      )}
    </div>
  );
}

function Opcion({
  icono,
  titulo,
  texto,
  destacada = false,
  onClick,
  href,
}: {
  icono: Icono;
  titulo: string;
  texto: string;
  destacada?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const clases = `group flex cursor-pointer flex-col items-start rounded-lg border-[1.5px] px-[30px] py-7 text-left text-text shadow-sm transition-[border-color,box-shadow,transform] duration-200 ease-out hover:shadow-md hover:text-text active:scale-[0.99] ${
    destacada ? 'border-accent-2-500 bg-accent-2-200 hover:border-accent-2-600' : 'border-neutral-400 bg-neutral-100 hover:border-accent-500'
  }`;
  const contenido = (
    <>
      <span className={`mb-[18px] grid size-[46px] place-items-center rounded-full border bg-bg ${destacada ? 'border-accent-2-500' : 'border-neutral-400'}`}>
        <Icon name={icono} size={24} className={destacada ? 'text-accent-2-700' : 'text-accent-700'} />
      </span>
      <span className="mb-2 flex items-center gap-2 text-[21px] font-black tracking-[-0.025em]">
        {titulo}
        <Icon name="arrow_forward" size={19} className="transition-transform duration-200 ease-out group-hover:translate-x-1" />
      </span>
      <span className={`text-[14.5px] leading-[1.55] font-semibold text-pretty ${destacada ? 'text-accent-2-900' : 'text-neutral-700'}`}>{texto}</span>
    </>
  );
  return href ? (
    <Link href={href} className={clases}>
      {contenido}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={clases}>
      {contenido}
    </button>
  );
}

function YaSoyPaciente({ titulo, onVolver }: { titulo: React.RefObject<HTMLHeadingElement | null>; onVolver: () => void }) {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string>();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Escribe un correo válido.');
      return;
    }
    setEnviando(true);
    setError(undefined);
    // Siempre 204: no revela si el correo tiene cuenta. Solo un 429 cambia el mensaje.
    const { response } = await api.POST('/api/auth/enlace-acceso', { body: { email: email.trim() } }).catch(() => ({ response: null }));
    setEnviando(false);
    if (response?.status === 429) setError('Hiciste varios intentos seguidos. Espera un minuto y vuelve a intentar.');
    else if (response && !response.ok && response.status >= 500) setError('No pudimos enviar el enlace. Intenta de nuevo en unos minutos.');
    else setEnviado(true);
  };

  return (
    <div className="entrada max-w-[560px] py-[clamp(32px,6vw,80px)]">
      <Eyebrow tone="patient">Ya soy paciente</Eyebrow>
      <h1 ref={titulo} tabIndex={-1} className="m-0 mb-4 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance outline-none">
        {enviado ? 'Revisa tu correo' : 'Entra con un enlace a tu correo'}
      </h1>
      {enviado ? (
        <div role="status" className="flex flex-col gap-5">
          <p className="m-0 text-base leading-relaxed text-pretty text-neutral-700">
            Si existe una cuenta con <strong className="text-text">{email.trim()}</strong>, te enviamos un enlace para entrar. Desde tu cuenta puedes pedir la
            hora con tu profesional.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/ingreso" variant="secondary" icon="key">
              Prefiero usar mi contraseña
            </ButtonLink>
            <Button variant="ghost" icon="arrow_back" onClick={onVolver}>
              Volver
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void enviar(e)} noValidate className="flex flex-col gap-5">
          <p className="m-0 text-base leading-relaxed text-pretty text-neutral-700">
            Por seguridad no mostramos datos de tu atención sin que entres a tu cuenta.
          </p>
          <Field label="Correo con el que te atiendes" required error={error}>
            {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="lg" icon="mail" loading={enviando}>
              Recibir enlace de acceso
            </Button>
            <Button variant="ghost" icon="arrow_back" onClick={onVolver}>
              Volver
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
