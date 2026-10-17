'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';

import { ResultadoEnlace as Resultado } from './ResultadoEnlace';
import { NOMBRE_MODALIDAD_CITA } from './SelectorHorario';

type Verificada = components['schemas']['SolicitudVerificada'];
type Estado = { tipo: 'listo'; r: Verificada } | { tipo: 'vencido' } | { tipo: 'error'; mensaje: string };

const PEDIR_OTRA = (
  <ButtonLink href="/pedir-hora" variant="team" size="lg" icon="calendar_month">
    Pedir una hora
  </ButtonLink>
);

/**
 * Enlace del correo (/pedir-hora/verificar?token=). El token se usa recien al
 * presionar el boton: un escaner de correo que abra el enlace no consume la
 * solicitud. Confirmada, por aprobar (profesional que revisa pacientes nuevos)
 * o vencida (la hora se libero).
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
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setEstado({ tipo: 'vencido' });
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
          Al confirmar, la hora retenida queda reservada a tu nombre y aceptas las condiciones que viste al pedirla.
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
        texto="Venció el tiempo de retención o el enlace ya se usó. Si no alcanzaste a confirmar, la hora se liberó para otras personas: pide una nueva."
        accion={PEDIR_OTRA}
      />
    );
  }
  const r = estado.r;
  const cuando = `${formatoFechaLarga(r.inicio)}, ${formatoHora(r.inicio)} · ${NOMBRE_MODALIDAD_CITA[r.modalidad]}`;
  if (r.estado === 'SOLICITADA') {
    return (
      <Resultado
        icono="hourglass_top"
        titulo="Solicitud enviada"
        texto="Tu correo quedó verificado y la hora está reservada como solicitud: el profesional revisa a los pacientes nuevos antes de confirmar. Te avisamos por correo cuando responda."
        detalle={cuando}
      />
    );
  }
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
      nota={r.adultoResponsable ? 'El adulto responsable debe acompañar al paciente en la primera sesión.' : undefined}
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
