'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';

import { ResultadoEnlace } from './ResultadoEnlace';

type Estado = { tipo: 'listo'; vence?: string; profesionalId?: string | null } | { tipo: 'vencido' } | { tipo: 'error'; mensaje: string };

const TEXTOS = {
  verificar: {
    titulo: 'Confirma tu inscripción',
    texto: 'Al confirmar quedas en la lista de espera y te avisamos por correo cuando haya horas disponibles. Cada aviso trae un enlace para salir.',
    boton: 'Confirmar inscripción',
    icono: 'check',
  },
  baja: {
    titulo: '¿Salir de la lista de espera?',
    texto: 'Dejarás de recibir avisos de horas disponibles y borraremos tus datos de la lista. Puedes volver a anotarte cuando quieras.',
    boton: 'Salir de la lista',
    icono: 'logout',
  },
} as const;

const EQUIPO = (
  <ButtonLink href="/equipo" variant="secondary" size="lg" icon="group">
    Ver al equipo
  </ButtonLink>
);

/**
 * Enlaces del correo de la lista de espera publica (03b): confirmar la
 * inscripcion o salir. Como en Pedir hora, el token se usa recien al
 * presionar el boton (un escaner de correo no lo consume).
 */
export function EnlaceListaEspera({ modo }: { modo: 'verificar' | 'baja' }) {
  const token = useSearchParams().get('token') ?? '';
  const [estado, setEstado] = useState<Estado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const t = TEXTOS[modo];

  const usar = async () => {
    setEnviando(true);
    try {
      if (modo === 'verificar') {
        const r = await datos(api.POST('/api/publico/lista-espera/verificacion', { body: { token } }));
        setEstado({ tipo: 'listo', vence: r.expiraEn, profesionalId: r.profesionalId });
      } else {
        await datos(api.POST('/api/publico/lista-espera/baja', { body: { token } }));
        setEstado({ tipo: 'listo' });
      }
    } catch (e) {
      if (e instanceof ApiError && [400, 404, 409].includes(e.status)) setEstado({ tipo: 'vencido' });
      else setEstado({ tipo: 'error', mensaje: e instanceof ApiError ? e.message : 'No pudimos completar la acción. Intenta de nuevo.' });
    } finally {
      setEnviando(false);
    }
  };

  if (!token) return <ResultadoEnlace icono="link" titulo="Enlace incompleto" texto="Abre el enlace completo que te enviamos al correo." accion={EQUIPO} />;
  if (!estado || estado.tipo === 'error') {
    return (
      <div className="entrada max-w-[600px] py-[clamp(32px,6vw,80px)]">
        <h1 className="m-0 mb-4 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{t.titulo}</h1>
        <p className="m-0 mb-7 text-base leading-relaxed text-pretty text-neutral-700">{t.texto}</p>
        {estado?.tipo === 'error' && (
          <p role="alert" className="m-0 mb-5 text-sm font-bold text-accent-700">
            {estado.mensaje}
          </p>
        )}
        <Button variant={modo === 'baja' ? 'secondary' : 'primary'} size="lg" icon={t.icono} loading={enviando} onClick={() => void usar()}>
          {t.boton}
        </Button>
      </div>
    );
  }
  if (estado.tipo === 'vencido') {
    return (
      <ResultadoEnlace
        icono="link_off"
        titulo="Este enlace ya no sirve"
        texto={
          modo === 'verificar'
            ? 'El enlace ya se usó o pasaron más de 24 horas. Si todavía quieres los avisos, anótate de nuevo desde el perfil del profesional.'
            : 'El enlace ya se usó o la inscripción venció: ya no estás en la lista de espera.'
        }
        accion={EQUIPO}
      />
    );
  }
  if (modo === 'baja') {
    return (
      <ResultadoEnlace
        icono="check_circle"
        titulo="Saliste de la lista de espera"
        texto="No te enviaremos más avisos y borramos tus datos de la lista."
        accion={EQUIPO}
      />
    );
  }
  return (
    <ResultadoEnlace
      icono="notifications_active"
      titulo="Quedaste en la lista de espera"
      texto="Te avisaremos por correo cuando haya horas disponibles. Te enviamos también un correo con el enlace para salir de la lista cuando quieras."
      detalle={estado.vence ? `Inscripción vigente hasta el ${formatoFechaLarga(new Date(estado.vence))}` : undefined}
      accion={
        estado.profesionalId ? (
          <ButtonLink href={`/pedir-hora/${estado.profesionalId}`} variant="primary" size="lg" icon="calendar_month">
            Ver sus horas ahora
          </ButtonLink>
        ) : (
          EQUIPO
        )
      }
    />
  );
}
