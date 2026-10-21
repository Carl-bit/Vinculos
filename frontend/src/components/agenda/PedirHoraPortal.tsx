'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoVista } from '@/components/shared/EstadoVista';
import { PagoCitaPortal } from '@/components/shared/PagoCitaPortal';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Casilla } from '@/components/ui/Casilla';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { condicionesAgendamiento, edadEn } from '@/lib/condiciones';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Bloque } from '@/lib/horarios';
import { clavesPortal, nombresDe, useEquipoPortal } from '@/lib/portal';

import { NOMBRE_MODALIDAD_CITA, SelectorHorario } from './SelectorHorario';

/**
 * "Pedir una hora" desde la cuenta: solo con el tratante actual (un tratante
 * por paciente; otro profesional = derivacion). Mismas horas que el sitio
 * publico (bloques de box), sin volver a dar datos. El adolescente no reserva:
 * lo hace su adulto responsable (D-4). Elegir no retiene: el 409 (otra
 * persona tomo la hora) refresca la grilla con un mensaje claro.
 */
export function PedirHoraPortal() {
  const portal = usePortal();
  const cliente = useQueryClient();
  const equipo = useEquipoPortal();
  const perfiles = useQuery({ queryKey: ['publico', 'profesionales'], queryFn: () => datos(api.GET('/api/publico/profesionales')), staleTime: 10 * 60_000 });
  const centro = useQuery({ queryKey: ['publico', 'centro'], queryFn: () => datos(api.GET('/api/publico/centro')), staleTime: 10 * 60_000 });
  const politica = useQuery({
    queryKey: ['publico', 'politica', 'POLITICA_DATOS'],
    queryFn: () => datos(api.GET('/api/publico/politicas/{tipo}', { params: { path: { tipo: 'POLITICA_DATOS' } } })),
  });
  const terminos = useQuery({
    queryKey: ['publico', 'politica', 'TERMINOS_AGENDAMIENTO'],
    queryFn: () => datos(api.GET('/api/publico/politicas/{tipo}', { params: { path: { tipo: 'TERMINOS_AGENDAMIENTO' } } })),
  });
  const [hora, setHora] = useState<Bloque | null>(null);
  const [acepta, setAcepta] = useState(false);
  const [errorAcepta, setErrorAcepta] = useState<string>();
  const [aviso, setAviso] = useState<string>();
  const alerta = useRef<HTMLDivElement>(null);

  const tratante = portal.paciente?.profesionalId ?? undefined;
  const perfil = perfiles.data?.find((p) => p.id === tratante);
  const nombre = (tratante && nombresDe(equipo.data).get(tratante)) || perfil?.nombre_publico || 'tu profesional';
  const menor = portal.paciente ? edadEn(portal.paciente.fechaNacimiento) < 18 : false;

  const reservar = useMutation({
    mutationFn: (b: Bloque) =>
      datos(
        api.POST('/api/portal/citas', {
          body: {
            pacienteId: portal.pacienteParam,
            modalidad: b.modalidad,
            inicio: b.inicio.toISOString(),
            fin: b.fin.toISOString(),
            politicaId: politica.data!.id,
            terminosId: terminos.data!.id,
          },
        }),
      ),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesPortal.todo }),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setHora(null);
        setAviso('Otra persona tomó esa hora mientras elegías. Te mostramos las horas libres actualizadas.');
        void cliente.invalidateQueries({ queryKey: ['disponibilidad-portal'] });
      } else setAviso(e instanceof ApiError ? e.message : 'No pudimos reservar la hora. Intenta de nuevo.');
    },
  });
  useEffect(() => {
    if (aviso) alerta.current?.focus();
  }, [aviso]);

  if (portal.cargando || equipo.isPending) return <EstadoVista estado="carga" />;
  if (portal.restringida) {
    return (
      <EstadoVista
        estado="sin-permiso"
        titulo="Tus horas las pide tu adulto responsable"
        mensaje="Desde su cuenta puede elegir una hora con tu profesional. Tú puedes escribirle a tu profesional desde Mi cuenta."
        accion={
          <ButtonLink href="/portal#mensajes" variant="secondary" icon="send">
            Escribirle a mi profesional
          </ButtonLink>
        }
      />
    );
  }
  if (!tratante) {
    return (
      <Panel titulo="Tu primera hora" bajada="Todavía no tienes un profesional asignado en el centro.">
        <div className="flex flex-wrap gap-2.5">
          <ButtonLink href="/match" variant="team" icon="join">
            Hacer el match terapéutico
          </ButtonLink>
          <ButtonLink href="/equipo" variant="secondary" icon="groups">
            Ver al equipo
          </ButtonLink>
        </div>
      </Panel>
    );
  }

  // 03b-3.1: con cuenta verificada no hay retencion: directo al paso de pago.
  if (reservar.data?.estado === 'PENDIENTE_PAGO') {
    return (
      <div className="entrada flex max-w-[680px] flex-col gap-5">
        <h2 className="m-0 text-[clamp(26px,3.4vw,36px)] leading-[1.05] font-black tracking-[-0.03em]">Falta el pago para confirmar tu hora</h2>
        {reservar.variables && (
          <p className="m-0 rounded-lg border border-divider bg-neutral-100 px-6 py-4 text-[16px] font-black tracking-[-0.02em] shadow-sm first-letter:uppercase">
            {formatoFechaLarga(reservar.variables.inicio)} a las {formatoHora(reservar.variables.inicio)} ·{' '}
            {NOMBRE_MODALIDAD_CITA[reservar.variables.modalidad]}
          </p>
        )}
        <PagoCitaPortal citaId={reservar.data.citaId} />
        <div>
          <ButtonLink href="/portal#horas" variant="ghost" icon="calendar_month">
            Ver mis horas
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (reservar.data) {
    const confirmada = reservar.data.estado === 'CONFIRMADA';
    return (
      <div role="status" className="entrada max-w-[640px]">
        <span className="mb-6 grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
          <Icon name={confirmada ? 'event_available' : 'schedule'} size={30} />
        </span>
        <h2 className="m-0 mb-3 text-[clamp(26px,3.4vw,36px)] leading-[1.05] font-black tracking-[-0.03em]">
          {confirmada ? 'Tu hora quedó confirmada' : 'Enviamos tu solicitud'}
        </h2>
        <p className="m-0 mb-5 text-[16px] leading-relaxed text-pretty text-neutral-700">
          {confirmada
            ? `Te enviamos la confirmación por correo${reservar.variables?.modalidad === 'ONLINE' ? ' con el enlace de la videollamada' : ''}.`
            : `${nombre} revisa las horas de pacientes nuevos y te avisará por correo cuando la apruebe.`}
        </p>
        {reservar.variables && (
          <p className="m-0 mb-6 rounded-lg border border-divider bg-neutral-100 px-6 py-4 text-[16px] font-black tracking-[-0.02em] shadow-sm first-letter:uppercase">
            {formatoFechaLarga(reservar.variables.inicio)} a las {formatoHora(reservar.variables.inicio)} ·{' '}
            {NOMBRE_MODALIDAD_CITA[reservar.variables.modalidad]}
          </p>
        )}
        <ButtonLink href="/portal#horas" variant="primary" icon="calendar_month">
          Ver mis horas
        </ButtonLink>
      </div>
    );
  }

  const confirmar = () => {
    setAviso(undefined);
    if (!acepta) {
      setErrorAcepta('Para reservar, acepta la política de datos y los términos de agendamiento.');
      return;
    }
    if (hora) reservar.mutate(hora);
  };

  return (
    <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Panel
        titulo={`Con ${nombre}`}
        bajada={portal.responsable ? `Elige una hora para ${portal.paciente?.nombre ?? 'tu menor'}.` : 'Elige una de sus horas libres.'}
      >
        <div className="mb-4 flex items-center gap-3">
          <AvatarProfesional nombre={perfil?.nombre_publico ?? nombre} foto={perfil?.foto_url ?? null} size={52} />
          {perfil && <span className="text-[13.5px] font-bold text-neutral-700">{perfil.especialidad}</span>}
        </div>
        {aviso && (
          <div ref={alerta} tabIndex={-1} className="mb-4 outline-none">
            <Aviso tono="advertencia" role="alert">
              {aviso}
            </Aviso>
          </div>
        )}
        <SelectorHorario
          profesionalId={tratante}
          portal={{ pacienteId: portal.pacienteParam }}
          valor={hora}
          onElegir={(b) => {
            setHora(b);
            setAviso(undefined);
          }}
          sinHoras={
            <Aviso tono="info" titulo="Por ahora no hay horas libres">
              Vuelve a revisar más adelante: tu profesional abre horas nuevas en su agenda.
            </Aviso>
          }
        />
      </Panel>

      <div className="flex flex-col gap-[18px] lg:sticky lg:top-6">
        <Panel titulo="Tu reserva">
          {hora ? (
            <p className="m-0 mb-4 text-[15.5px] font-black tracking-[-0.02em] first-letter:uppercase">
              {formatoFechaLarga(hora.inicio)}, {formatoHora(hora.inicio)} · {NOMBRE_MODALIDAD_CITA[hora.modalidad]}
            </p>
          ) : (
            <p className="m-0 mb-4 text-[13.5px] font-semibold text-neutral-700">Elige una hora en la grilla.</p>
          )}
          {centro.data && (
            <ul className="m-0 mb-4 flex flex-col gap-1.5 pl-5">
              {condicionesAgendamiento(centro.data, menor).map((c) => (
                <li key={c} className="text-[13px] leading-[1.55] font-semibold text-pretty text-neutral-800">
                  {c}
                </li>
              ))}
            </ul>
          )}
          {politica.data && terminos.data ? (
            <Casilla
              checked={acepta}
              onChange={(v) => {
                setAcepta(v);
                setErrorAcepta(undefined);
              }}
              error={errorAcepta}
            >
              Acepto la{' '}
              <Link href="/politicas/POLITICA_DATOS" target="_blank" className="font-extrabold underline underline-offset-2">
                política de datos
              </Link>{' '}
              (v{politica.data.version}) y los{' '}
              <Link href="/politicas/TERMINOS_AGENDAMIENTO" target="_blank" className="font-extrabold underline underline-offset-2">
                términos de agendamiento
              </Link>{' '}
              (v{terminos.data.version}).
            </Casilla>
          ) : (
            (politica.error || terminos.error) && (
              <Aviso tono="advertencia">El centro todavía no publica sus políticas: no se pueden reservar horas en línea.</Aviso>
            )
          )}
          <Button
            size="lg"
            icon="check"
            className="mt-4 w-full"
            disabled={!hora || !politica.data || !terminos.data}
            loading={reservar.isPending}
            onClick={confirmar}
          >
            Reservar esta hora
          </Button>
        </Panel>
        <Aviso tono="nota" icono="info">
          ¿Quieres atenderte con otra persona del equipo? El cambio de profesional se hace con una derivación: pídeselo a {nombre} o escríbele al centro.
        </Aviso>
      </div>
    </div>
  );
}
