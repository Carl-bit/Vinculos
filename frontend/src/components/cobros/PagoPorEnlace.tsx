'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { ResultadoPago } from '@/components/shared/PagoCitaPortal';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { caminoEnlace, useEstadoPago } from '@/lib/pagos';

/**
 * 03b-3.4: pagina del enlace de pago que llega por correo a quien no tiene
 * cuenta (hora pendiente de pago o saldo de una sesion ya realizada). Sin
 * sesion: el token solo autoriza ver y pagar ESA cita, sin datos personales
 * del paciente. Mismo paso de pago que la reserva y el portal; el estado se
 * consulta solo mientras la pestaña esta visible.
 */
export function PagoPorEnlace() {
  const enlace = useSearchParams().get('t') ?? '';
  const camino = useMemo(() => (enlace ? caminoEnlace(enlace) : null), [enlace]);
  const resumen = useQuery({
    queryKey: ['enlace-pago', 'resumen', enlace],
    queryFn: () => datos(api.POST('/api/publico/pagos/resumen', { body: { enlace } })),
    enabled: !!enlace,
    retry: false,
  });
  const estado = useEstadoPago(resumen.isSuccess ? camino : null);

  if (!enlace) return <Mensaje icono="link" titulo="Enlace incompleto" texto="Abre el enlace completo que te enviamos al correo." />;
  if (resumen.isPending) return <EstadoVista estado="carga" titulo="Buscando tu sesión…" />;
  if (resumen.error) {
    const e = resumen.error;
    if (e instanceof ApiError && e.status === 404)
      return <Mensaje icono="link_off" titulo="No encontramos este enlace" texto="Revisa que el enlace esté completo o escríbele al centro." />;
    if (e instanceof ApiError && e.status === 409)
      return (
        <Mensaje
          icono="schedule"
          titulo="El enlace venció"
          texto="Por seguridad, el enlace de pago dura 30 días. Escríbele al centro para recibir uno nuevo."
        />
      );
    return <EstadoVista estado="error" mensaje={e instanceof ApiError ? e.message : undefined} />;
  }
  const r = resumen.data;
  return (
    <div className="entrada flex max-w-[680px] flex-col gap-6 py-[clamp(32px,6vw,80px)]">
      <header className="flex flex-col gap-2">
        <p className="m-0 text-[12px] font-extrabold tracking-[0.1em] text-accent-2-800 uppercase">Pago de tu sesión</p>
        <h1 className="m-0 text-[clamp(28px,4vw,40px)] leading-[1.05] font-black tracking-[-0.035em] text-balance first-letter:uppercase">
          {formatoFechaLarga(r.inicio)}, {formatoHora(r.inicio)}
        </h1>
        <p className="m-0 text-[15.5px] font-semibold text-neutral-700">
          {r.modalidad === 'ONLINE' ? 'Sesión online' : 'Sesión presencial'}
          {r.profesional ? ` con ${r.profesional}` : ''}
        </p>
      </header>
      <EstadoConsulta consulta={estado}>{(e) => <ResultadoPago estado={e} camino={camino!} otraHora="/pedir-hora" />}</EstadoConsulta>
    </div>
  );
}

function Mensaje({ icono, titulo, texto }: { icono: Icono; titulo: string; texto: string }) {
  return (
    <div role="status" className="entrada max-w-[600px] py-[clamp(32px,6vw,80px)]">
      <span className="mb-6 grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200">
        <Icon name={icono} size={30} className="text-accent-2-700" />
      </span>
      <h1 className="m-0 mb-3.5 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{titulo}</h1>
      <p className="m-0 text-[16.5px] leading-relaxed text-pretty text-neutral-700">{texto}</p>
    </div>
  );
}
