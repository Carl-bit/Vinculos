'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';

import { ResultadoEnlace as Resultado } from './ResultadoEnlace';
import { NOMBRE_MODALIDAD_CITA } from './SelectorHorario';

type Verificada = components['schemas']['SolicitudVerificada'];
type Alternativa = components['schemas']['AlternativaHorario'];
type Estado = { tipo: 'listo'; r: Verificada } | { tipo: 'vencido' } | { tipo: 'tomada'; alternativas: Alternativa[] } | { tipo: 'error'; mensaje: string };

/** 03b-3.1: la pestaña donde se pidio la hora consulta el estado y avanza sola. */
const VOLVER_A_LA_PESTANA = 'Si la pestaña donde pediste la hora sigue abierta, puedes volver a ella: ya avanzó sola.';

const PEDIR_OTRA = (
  <ButtonLink href="/pedir-hora" variant="team" size="lg" icon="calendar_month">
    Pedir una hora
  </ButtonLink>
);

/**
 * Enlace del correo (/pedir-hora/verificar?token=). 03b-3.2: solo existe
 * cuando se paga en el centro; los demas medios confirman con el pago. El
 * token se usa recien al presionar el boton: un escaner de correo que abra el
 * enlace no consume la solicitud. Confirmada, tomada (la retencion vencio y
 * otra persona tomo la hora: horas cercanas) o vencida. Si despues se eligio
 * pagar antes, la API responde 409 con el motivo (se muestra tal cual).
 */
export function VerificarSolicitud() {
  const token = useSearchParams().get('token') ?? '';
  const [estado, setEstado] = useState<Estado | null>(null);
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    setEnviando(true);
    try {
      setEstado({ tipo: 'listo', r: await datos(api.POST('/api/publico/solicitudes/verificacion', { body: { token } })) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.cuerpo.restriccion === 'solicitudes_hora_tomada')
        setEstado({ tipo: 'tomada', alternativas: e.cuerpo.alternativas ?? [] });
      else if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setEstado({ tipo: 'vencido' });
      else setEstado({ tipo: 'error', mensaje: e instanceof ApiError ? e.message : 'No pudimos confirmar la hora. Intenta de nuevo.' });
    } finally {
      setEnviando(false);
    }
  };

  if (!token) return <Resultado icono="link" titulo="Enlace incompleto" texto="Abre el enlace completo que te enviamos al correo." accion={PEDIR_OTRA} />;
  if (!estado || estado.tipo === 'error') {
    return (
      <div className="entrada max-w-[600px] py-[clamp(32px,6vw,80px)]">
        <Eyebrow tone="patient">Confirmar hora</Eyebrow>
        <h1 className="m-0 mb-4 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">Confirma tu correo para reservar</h1>
        <p className="m-0 mb-7 text-base leading-relaxed text-pretty text-neutral-700">
          Al confirmar, la hora que elegiste queda reservada a tu nombre (pagas en el centro, el día de tu sesión) y aceptas las condiciones que viste al
          pedirla.
        </p>
        {estado?.tipo === 'error' && (
          <p role="alert" className="m-0 mb-5 text-sm font-bold text-accent-700">
            {estado.mensaje}
          </p>
        )}
        <Button variant="team" size="lg" icon="check" loading={enviando} onClick={() => void confirmar()}>
          Confirmar mi hora
        </Button>
      </div>
    );
  }
  if (estado.tipo === 'vencido') {
    return (
      <Resultado
        icono="event_busy"
        titulo="Este enlace ya no sirve"
        texto="Venció el tiempo para confirmar o el enlace ya se usó. Si no alcanzaste a confirmar, la hora se liberó para otras personas: pide una nueva."
        accion={PEDIR_OTRA}
      />
    );
  }
  if (estado.tipo === 'tomada') {
    return (
      <Resultado
        icono="event_busy"
        titulo="La hora ya no está disponible"
        texto={
          estado.alternativas.length
            ? `Pasó el tiempo para confirmar y otra persona tomó esa hora. Las más cercanas: ${estado.alternativas
                .map((a) => `${formatoFechaLarga(a.inicio)}, ${formatoHora(a.inicio)}`)
                .join('; ')}. Pide una nueva desde el perfil del profesional.`
            : 'Pasó el tiempo para confirmar y otra persona tomó esa hora. Pide una nueva desde el perfil del profesional.'
        }
        accion={PEDIR_OTRA}
      />
    );
  }
  const r = estado.r;
  const cuando = `${formatoFechaLarga(r.inicio)}, ${formatoHora(r.inicio)} · ${NOMBRE_MODALIDAD_CITA[r.modalidad]}`;
  return (
    <Resultado
      icono="check_circle"
      titulo="Tu hora quedó confirmada"
      texto={
        r.invitacionEnviada
          ? 'Te enviamos otro correo para crear tu cuenta: desde ahí ves tus horas, pagos y documentos.'
          : 'Puedes ver tus horas desde tu cuenta del centro.'
      }
      detalle={cuando}
      nota={r.adultoResponsable ? `El adulto responsable debe acompañar al paciente en la primera sesión. ${VOLVER_A_LA_PESTANA}` : VOLVER_A_LA_PESTANA}
      accion={
        r.invitacionEnviada ? undefined : (
          <ButtonLink href="/ingreso" variant="secondary" size="lg" icon="account_circle">
            Ir a mi cuenta
          </ButtonLink>
        )
      }
    />
  );
}
