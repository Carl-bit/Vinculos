'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { ESTADO_PAGO, MEDIO_PAGO } from '@/lib/cobros';
import { formatoClp, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { nombresDe, useCobrosPortal, useEquipoPortal, type EstadoPagoCita } from '@/lib/portal';

/**
 * Pagos del portal (paciente adulto o adulto responsable): estado de cada
 * cita (monto fijado al confirmar, pagado, saldo), detalle de pagos y
 * boleta, y los datos para transferir cuando el profesional cobra directo y
 * queda saldo. El pago se registra en el centro: no hay pasarela.
 */
export function PagosPortal() {
  const portal = usePortal();
  const cobros = useCobrosPortal(!portal.cargando);
  const equipo = useEquipoPortal();
  const nombres = nombresDe(equipo.data);
  const filas = (cobros.data ?? [])
    .filter((c) => !portal.pacienteId || c.paciente_id === portal.pacienteId)
    .filter((c) => c.estado_pago !== 'SIN_COBRO' || c.pagado > 0)
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  const saldo = filas.reduce((s, c) => s + Math.max(c.saldo, 0), 0);

  return (
    <div className="flex flex-col gap-[18px]">
      {saldo > 0 && (
        <Aviso tono="advertencia" icono="payments" titulo={`Tienes ${formatoClp(saldo)} por pagar`}>
          Puedes pagar en el centro o, si tu profesional cobra directo, por transferencia con los datos de cada sesión.
        </Aviso>
      )}
      <Panel titulo="Pagos de tus sesiones" bajada="El monto de cada sesión queda fijo cuando se confirma la hora. Los pagos los registra el centro.">
        <EstadoConsulta consulta={cobros} vacio={() => filas.length === 0} textoVacio="Todavía no hay pagos ni cobros registrados">
          {() => (
            <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
              {filas.map((c) => (
                <FilaPago key={c.cita_id} c={c} profesional={nombres.get(c.profesional_id) ?? 'Profesional del centro'} />
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </Panel>
    </div>
  );
}

function FilaPago({ c, profesional }: { c: EstadoPagoCita; profesional: string }) {
  const [abierto, setAbierto] = useState(false);
  const e = ESTADO_PAGO[c.estado_pago];
  const detalle = useQuery({
    queryKey: ['portal', 'cobro', c.cita_id],
    queryFn: () => datos(api.GET('/api/cobros/citas/{id}', { params: { path: { id: c.cita_id } } })),
    enabled: abierto,
  });
  return (
    <li className="rounded-[18px] border border-divider bg-bg px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="min-w-0 flex-[1_1_200px]">
          <p className="m-0 text-[14.5px] font-black tracking-[-0.015em] first-letter:uppercase">{formatoFechaLarga(c.inicio)}</p>
          <p className="m-0 text-[13px] font-semibold text-neutral-700">
            {formatoHora(c.inicio)} · {profesional}
            {c.estado_cita === 'CANCELADA' ? ' · Cancelada' : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="m-0 text-[15px] font-black tabular-nums">{formatoClp(c.exigible)}</p>
          {c.saldo > 0 && c.pagado > 0 && <p className="m-0 text-xs font-bold text-neutral-700 tabular-nums">Saldo {formatoClp(c.saldo)}</p>}
        </div>
        <Badge tono={e.tono}>{e.texto}</Badge>
      </div>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="mt-2 flex min-h-10 cursor-pointer items-center gap-1.5 text-[13px] font-extrabold text-accent-2-700 hover:text-accent-2-800"
      >
        <Icon name={abierto ? 'expand_less' : 'expand_more'} size={18} />
        {abierto ? 'Ocultar detalle' : 'Ver detalle'}
      </button>
      {abierto && (
        <div className="mt-2 flex flex-col gap-3 border-t border-divider pt-3.5">
          <EstadoConsulta consulta={detalle}>
            {(d) => (
              <>
                {d.pagos.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13.5px] font-semibold">
                    {d.pagos.map((p) => (
                      <li key={p.id} className={`flex flex-wrap justify-between gap-2 ${p.estado === 'ANULADO' ? 'text-neutral-700 line-through' : ''}`}>
                        <span>
                          {formatoFechaLarga(p.fecha)} · {MEDIO_PAGO[p.medioPago]}
                          {p.estado === 'ANULADO' ? ' (anulado)' : ''}
                        </span>
                        <span className="font-extrabold tabular-nums">{formatoClp(p.monto)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[13px] font-semibold text-neutral-700">Sin pagos registrados.</p>
                )}
                {d.resolucion && (
                  <p className="m-0 text-[13px] font-semibold text-neutral-700">
                    {d.resolucion.decision === 'INASISTENCIA'
                      ? 'Inasistencia sin aviso: aplica el cobro según la política del centro.'
                      : d.resolucion.decision === 'TRASLADO'
                        ? 'Lo pagado se traspasó a tu nueva hora.'
                        : `Cancelación: corresponde devolver ${formatoClp(d.resolucion.montoDevolucion)}.`}
                  </p>
                )}
                {d.boleta && (
                  <p className="m-0 flex items-center gap-2 text-[13px] font-bold">
                    <Icon name="receipt_long" size={17} className="text-accent-2-700" />
                    Boleta n.º {d.boleta.numero} por {formatoClp(d.boleta.monto)}
                  </p>
                )}
                {c.saldo > 0 && c.estado_cita === 'CONFIRMADA' && <DatosTransferencia citaId={c.cita_id} />}
              </>
            )}
          </EstadoConsulta>
        </div>
      )}
    </li>
  );
}

/** Datos bancarios del profesional: solo con cobro directo y saldo pendiente (la consulta queda auditada en la API). */
function DatosTransferencia({ citaId }: { citaId: string }) {
  const [pedir, setPedir] = useState(false);
  const consulta = useQuery({
    queryKey: ['portal', 'datos-pago', citaId],
    queryFn: () => datos(api.GET('/api/portal/citas/{id}/datos-pago', { params: { path: { id: citaId } } })),
    enabled: pedir,
    staleTime: 0,
    gcTime: 0,
  });
  if (!pedir) {
    return (
      <div>
        <Button variant="secondary" icon="account_balance" onClick={() => setPedir(true)} className="!py-2.5">
          Ver datos para transferir
        </Button>
      </div>
    );
  }
  if (consulta.isPending) return <span aria-hidden="true" className="esqueleto block h-16 rounded-lg" />;
  if (consulta.error) {
    return (
      <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
        {consulta.error instanceof ApiError ? consulta.error.message : 'No pudimos cargar los datos.'}
      </p>
    );
  }
  const d = consulta.data;
  if (!d.aplica) return <p className="m-0 text-[13px] font-semibold text-neutral-700">Esta sesión se paga directamente en el centro.</p>;
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[16px] border border-accent-2-500 bg-accent-2-100 px-4 py-3 text-[13.5px]">
      {(
        [
          ['Titular', d.titular],
          ['RUT', d.rut],
          ['Banco', d.banco],
          ['Tipo de cuenta', d.tipoCuenta?.replace(/_/g, ' ').toLowerCase()],
          ['Número', d.numeroCuenta],
        ] as const
      ).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-extrabold text-accent-2-900">{k}</dt>
          <dd className="m-0 font-semibold break-all select-all first-letter:uppercase">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
