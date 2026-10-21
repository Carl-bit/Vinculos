'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { caminoPortal, esFinal, useEstadoPago, type CaminoPago, type EstadoConfirmacion } from '@/lib/pagos';
import { clavesPortal } from '@/lib/portal';

import { PasoPago } from './PasoPago';

/**
 * Pago de una cita desde la cuenta del paciente (03b-3.1): el paso de pago
 * mientras esta PENDIENTE_PAGO (tambien la que agenda el equipo, 03b-3.2:
 * plazo del centro; 03b-3.3: si vence sin pago se paga en el centro) y el
 * resultado cuando cambia (la consulta se repite sola mientras la pestaña
 * esta visible). 03b-3.4: tambien el saldo de una sesion ya realizada
 * (SALDO_PENDIENTE). Al terminar, refresca las horas y pagos del portal.
 */
export function PagoCitaPortal({ citaId, agendadaPorEquipo = false }: { citaId: string; agendadaPorEquipo?: boolean }) {
  const camino = useMemo(() => caminoPortal(citaId), [citaId]);
  const consulta = useEstadoPago(camino);
  const cliente = useQueryClient();
  const final = esFinal(consulta.data);
  useEffect(() => {
    if (final) void cliente.invalidateQueries({ queryKey: clavesPortal.todo });
  }, [final, cliente]);

  return (
    <EstadoConsulta consulta={consulta}>
      {(e) => <ResultadoPago estado={e} camino={camino} seMantiene={agendadaPorEquipo} otraHora="/portal/pedir-hora" />}
    </EstadoConsulta>
  );
}

/**
 * Paso de pago o resultado de una cita (portal o enlace de pago). Recuerda si
 * empezo como saldo de una sesion realizada para decir "pago registrado" en
 * vez de "hora confirmada" al terminar.
 */
export function ResultadoPago({
  estado: e,
  camino,
  seMantiene = false,
  otraHora,
}: {
  estado: EstadoConfirmacion;
  camino: CaminoPago;
  seMantiene?: boolean;
  /** Donde pedir otra hora si se libero. */
  otraHora: string;
}) {
  // El primer estado que se ve decide si es el pago de un saldo (no cambia al pagar).
  const [eraSaldo] = useState(e.estado === 'SALDO_PENDIENTE');

  if (e.estado === 'PENDIENTE_PAGO' || e.estado === 'SALDO_PENDIENTE') {
    return <PasoPago camino={camino} estado={e} seMantiene={seMantiene} />;
  }
  if (eraSaldo) {
    return (
      <Aviso tono="exito" titulo="Pago registrado" role="status">
        La sesión quedó sin saldo pendiente. Ya puedes agendar tu próxima hora.
      </Aviso>
    );
  }
  if (e.estado === 'CONFIRMADA') {
    return (
      <Aviso tono="exito" titulo="Tu hora quedó confirmada" role="status">
        {e.medio === 'PAGO_EN_CENTRO' ? 'Pagas al llegar a tu sesión. ' : ''}Te enviamos la confirmación por correo.
      </Aviso>
    );
  }
  if (e.estado === 'CANCELADA' || e.estado === 'POR_REPROGRAMAR') {
    return (
      <Aviso tono="info" titulo="Esta hora ya no espera un pago" role="status">
        La hora cambió de estado. Si tienes dudas, escríbele al centro.
      </Aviso>
    );
  }
  return (
    <Aviso
      tono="advertencia"
      titulo="La hora se liberó"
      role="status"
      accion={
        <ButtonLink href={otraHora} variant="secondary" icon="calendar_month">
          Pedir otra hora
        </ButtonLink>
      }
    >
      Venció el plazo de pago y la hora quedó disponible para otras personas.
    </Aviso>
  );
}
