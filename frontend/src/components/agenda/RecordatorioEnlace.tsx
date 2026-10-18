'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { EstadoVista } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';

import { ResultadoEnlace } from './ResultadoEnlace';

/**
 * Pagina del recordatorio por correo (02i), sin sesion: muestra la cita y la
 * politica de cancelacion que aplicaria AHORA (a tiempo sin cargo, o tardia
 * con penalizacion), y deja confirmar o cancelar. Un solo uso.
 */
export function RecordatorioEnlace() {
  const token = useSearchParams().get('token') ?? '';
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: ['recordatorio', token],
    queryFn: () => datos(api.GET('/api/recordatorios/{token}', { params: { path: { token } } })),
    enabled: !!token,
  });
  const [cancelar, setCancelar] = useState(false);
  const [resultado, setResultado] = useState<{ respuesta: 'CONFIRMADA' | 'CANCELADA'; aTiempo?: boolean; penalizacion?: number }>();
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  if (!token) return <ResultadoEnlace icono="link" titulo="Enlace incompleto" texto="Abre el enlace completo del recordatorio que te enviamos al correo." />;
  if (consulta.isPending) return <EstadoVista estado="carga" titulo="Buscando tu hora…" />;
  if (consulta.error) {
    return consulta.error instanceof ApiError && consulta.error.status === 404 ? (
      <ResultadoEnlace
        icono="link_off"
        titulo="No encontramos este recordatorio"
        texto="Revisa que el enlace esté completo o escríbele a tu profesional desde tu cuenta."
        accion={cuenta}
      />
    ) : (
      <EstadoVista estado="error" mensaje={consulta.error instanceof ApiError ? consulta.error.message : undefined} />
    );
  }
  const r = consulta.data;
  const cuando = `${formatoFechaLarga(r.inicio)} a las ${formatoHora(r.inicio)}`;

  const responder = async (tipo: 'confirmacion' | 'cancelacion') => {
    setEnviando(true);
    setError(undefined);
    try {
      const ruta = tipo === 'confirmacion' ? '/api/recordatorios/{token}/confirmacion' : '/api/recordatorios/{token}/cancelacion';
      const res = await datos(api.POST(ruta, { params: { path: { token } } }));
      setResultado({ respuesta: res.respuesta, aTiempo: res.cancelacion?.aTiempo, penalizacion: res.cancelacion?.penalizacionPorcentaje });
      setCancelar(false);
    } catch (e) {
      setCancelar(false);
      if (e instanceof ApiError && e.status === 409) {
        setError('Esta hora ya cambió o el recordatorio ya se respondió. Revisa tu cuenta para ver el estado actual.');
        void cliente.invalidateQueries({ queryKey: ['recordatorio', token] });
      } else setError(e instanceof ApiError ? e.message : 'No pudimos registrar tu respuesta. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (resultado?.respuesta === 'CONFIRMADA') {
    return (
      <ResultadoEnlace
        icono="event_available"
        titulo="¡Te esperamos!"
        texto="Confirmaste tu asistencia. Tu profesional ya lo sabe."
        detalle={cuando}
        accion={cuenta}
      />
    );
  }
  if (resultado?.respuesta === 'CANCELADA') {
    return (
      <ResultadoEnlace
        icono="event_busy"
        titulo="Cancelamos tu hora"
        texto={
          resultado.aTiempo
            ? 'Avisaste con anticipación: la cancelación no tiene cargo. Si pagaste, el centro te indicará cómo se usa ese pago.'
            : `La cancelación fue fuera de plazo: aplica el ${resultado.penalizacion ?? 0}% de cargo según la política del centro.`
        }
        detalle={cuando}
        accion={
          <ButtonLink href="/portal/pedir-hora" variant="primary" size="lg" icon="calendar_month">
            Pedir otra hora
          </ButtonLink>
        }
      />
    );
  }

  const c = r.cancelacion;
  return (
    <article className="entrada max-w-[640px] py-[clamp(28px,5vw,64px)]">
      <h1 className="m-0 mb-4 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">Recordatorio de tu hora</h1>
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-divider bg-neutral-100 px-6 py-5 shadow-sm">
        <span className="grid size-11 flex-none place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
          <Icon name={r.modalidad === 'ONLINE' ? 'videocam' : 'event_available'} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[17px] font-black tracking-[-0.02em] first-letter:uppercase">{cuando}</p>
          <p className="m-0 text-[13.5px] font-semibold text-neutral-700">
            {r.modalidad === 'ONLINE' ? 'Online' : 'Presencial'}
            {r.profesional ? ` · ${r.profesional}` : ''}
          </p>
        </div>
        {r.respuesta && (
          <Badge tono={r.respuesta === 'CONFIRMADA' ? 'positivo' : 'atencion'}>{r.respuesta === 'CONFIRMADA' ? 'Confirmada' : 'Cancelada'}</Badge>
        )}
      </div>

      {!r.vigente ? (
        <Aviso tono="info" titulo={r.respuesta ? 'Ya respondiste este recordatorio' : 'Este recordatorio ya no se puede responder'}>
          {r.respuesta
            ? 'Si necesitas cambiar algo, escríbele a tu profesional desde tu cuenta.'
            : 'La hora ya pasó o cambió. Revisa tu cuenta para ver el estado actual de tus horas.'}
        </Aviso>
      ) : (
        <>
          <Aviso
            tono={c.aTiempo ? 'exito' : 'advertencia'}
            titulo={c.aTiempo ? 'Si cancelas ahora, no tiene cargo' : 'Si cancelas ahora, tiene cargo'}
            className="mb-6"
          >
            {c.aTiempo
              ? `Todavía estás dentro del plazo de aviso${c.plazoAvisoHoras ? ` de ${c.plazoAvisoHoras} horas` : ''}.`
              : `Faltan menos de ${c.plazoAvisoHoras ?? 'las'} horas para la sesión: según la política del centro se cobra el ${c.penalizacionPorcentaje}% del valor.`}
          </Aviso>
          {error && (
            <p role="alert" className="m-0 mb-4 text-[14px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button size="lg" icon="check" loading={enviando && !cancelar} onClick={() => void responder('confirmacion')}>
              Confirmo que asistiré
            </Button>
            <Button size="lg" variant="secondary" icon="event_busy" onClick={() => setCancelar(true)}>
              Necesito cancelar
            </Button>
          </div>
        </>
      )}
      <div className="mt-8">{cuenta}</div>

      <Modal
        abierto={cancelar}
        onCerrar={() => setCancelar(false)}
        titulo="¿Cancelar esta hora?"
        descripcion={
          c.aTiempo
            ? 'La hora queda libre para otra persona. Como avisas dentro del plazo, no tiene cargo.'
            : `La hora queda libre para otra persona. Como faltan menos de ${c.plazoAvisoHoras ?? 'las'} horas, aplica el ${c.penalizacionPorcentaje}% de cargo.`
        }
        acciones={
          <>
            <Button variant="ghost" onClick={() => setCancelar(false)}>
              Mantener mi hora
            </Button>
            <Button variant="team" loading={enviando} onClick={() => void responder('cancelacion')}>
              Sí, cancelar
            </Button>
          </>
        }
      />
    </article>
  );
}

const cuenta = (
  <ButtonLink href="/portal" variant="secondary" icon="person">
    Ir a mi cuenta
  </ButtonLink>
);
