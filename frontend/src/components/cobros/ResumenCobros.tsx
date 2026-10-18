'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Estadistica } from '@/components/shared/Estadistica';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { MEDIO_PAGO, useReporteCobros, type Periodo } from '@/lib/cobros';
import { useConfiguracionCentro } from '@/lib/centro';
import { formatoClp } from '@/lib/formato';
import type { Rol } from '@/lib/sesion';

/**
 * Resumen del periodo (diseño "Cobros"): sesiones realizadas, cobrado,
 * pendiente y comision del centro por profesional, y medios de pago. Solo
 * montos y volumen: nada clinico. La comision es un porcentaje del centro
 * sobre lo cobrado (configuracion), no un cobro por derivacion: el modelo
 * "fijo o porcentaje por paciente derivado" del diseño no existe en la BD.
 */
export function ResumenCobros({ periodo, rol, onLiquidado }: { periodo: Periodo; rol: Rol; onLiquidado: () => void }) {
  const reporte = useReporteCobros(periodo);
  const configuracion = useConfiguracionCentro();
  const cliente = useQueryClient();
  const gestiona = rol === 'ADMIN' || rol === 'GESTION';
  const [error, setError] = useState<string>();
  const liquidar = useMutation({
    mutationFn: (profesionalId: string) =>
      datos(api.POST('/api/cobros/liquidaciones', { body: { profesionalId, desde: periodo.desde, hasta: periodo.hasta } })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['panel', 'cobros', 'liquidaciones'] });
      onLiquidado();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? 'Ya hay una liquidación emitida que se cruza con este período para ese profesional.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos generar la liquidación.',
      ),
  });

  return (
    <EstadoConsulta consulta={reporte}>
      {(r) => {
        const suma = (k: 'sesiones' | 'cobrado' | 'pendiente' | 'comision_estimada') => r.profesionales.reduce((s, p) => s + p[k], 0);
        const maxMedio = Math.max(1, ...r.medios.map((m) => m.monto));
        return (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              <Estadistica etiqueta="Sesiones realizadas" valor={suma('sesiones')} nota="Del período" />
              <Estadistica etiqueta="Total cobrado" valor={formatoClp(suma('cobrado'))} nota="Pagos registrados" notaTono="positiva" />
              <Estadistica
                etiqueta="Pendiente de pago"
                valor={formatoClp(suma('pendiente'))}
                nota="Saldo de sesiones realizadas"
                notaTono={suma('pendiente') > 0 ? 'atencion' : 'neutra'}
              />
              <Estadistica
                etiqueta="Comisión del centro"
                valor={formatoClp(suma('comision_estimada'))}
                nota={`${String(configuracion.data?.comisionCentroPorcentaje ?? '…')}% de lo cobrado`}
              />
            </div>

            <Panel titulo="Liquidación por profesional" bajada="Solo montos y volumen de sesiones. No incluye información clínica de los pacientes.">
              <div className="mt-4">
                {r.profesionales.length === 0 ? (
                  <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Sin sesiones realizadas en el período.</p>
                ) : (
                  <Tabla etiqueta="Liquidación por profesional">
                    <thead>
                      <tr>
                        <Th>Profesional</Th>
                        <Th className="text-right">Sesiones</Th>
                        <Th className="text-right">Cobrado</Th>
                        <Th className="text-right">Pendiente</Th>
                        <Th className="text-right">Comisión</Th>
                        {gestiona && (
                          <Th>
                            <span className="sr-only">Acciones</span>
                          </Th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {r.profesionales.map((p) => (
                        <tr key={p.profesional_id}>
                          <Td>
                            <span className="flex items-center gap-3 font-extrabold">
                              <Avatar name={p.nombre ?? 'Profesional'} size={32} />
                              {p.nombre ?? 'Profesional'}
                            </span>
                          </Td>
                          <Td className="text-right font-bold tabular-nums">{p.sesiones}</Td>
                          <Td className="text-right font-bold tabular-nums">{formatoClp(p.cobrado)}</Td>
                          <Td className={`text-right font-bold tabular-nums ${p.pendiente ? 'text-accent-700' : 'text-neutral-700'}`}>
                            {p.pendiente ? formatoClp(p.pendiente) : '—'}
                          </Td>
                          <Td className="text-right font-bold tabular-nums">{p.comision_estimada ? formatoClp(p.comision_estimada) : '—'}</Td>
                          {gestiona && (
                            <Td className="text-right">
                              <Button
                                variant="ghost"
                                icon="receipt_long"
                                loading={liquidar.isPending && liquidar.variables === p.profesional_id}
                                onClick={() => liquidar.mutate(p.profesional_id)}
                                className="!px-3.5 !py-2 !text-[12.5px]"
                              >
                                Liquidar
                              </Button>
                            </Td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-neutral-200">
                        <Td className="font-black">Total</Td>
                        <Td className="text-right font-black tabular-nums">{suma('sesiones')}</Td>
                        <Td className="text-right font-black tabular-nums">{formatoClp(suma('cobrado'))}</Td>
                        <Td className="text-right font-black tabular-nums">{formatoClp(suma('pendiente'))}</Td>
                        <Td className="text-right font-black tabular-nums">{formatoClp(suma('comision_estimada'))}</Td>
                        {gestiona && <Td />}
                      </tr>
                    </tfoot>
                  </Tabla>
                )}
                {error && (
                  <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
                    {error}
                  </p>
                )}
                {configuracion.data?.liquidarExigeEvolucion && (
                  <p className="m-0 mt-3 text-[12.5px] font-semibold text-neutral-700">
                    El centro liquida solo sesiones realizadas con la evolución registrada.
                  </p>
                )}
              </div>
            </Panel>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel titulo="Métodos de pago del período" bajada="Pagos registrados (no anulados) por medio.">
                <div className="mt-4 flex flex-col gap-3">
                  {r.medios.length === 0 && <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Sin pagos en el período.</p>}
                  {r.medios.map((m) => (
                    <div key={m.medio}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13.5px] font-extrabold">
                        <span>{MEDIO_PAGO[m.medio]}</span>
                        <span className="tabular-nums">
                          {formatoClp(m.monto)} · {m.pagos} {m.pagos === 1 ? 'pago' : 'pagos'}
                        </span>
                      </div>
                      <span className="block h-[7px] overflow-hidden rounded-full bg-neutral-300" aria-hidden>
                        <span className="block h-full rounded-full bg-accent-2-600" style={{ width: `${Math.round((m.monto / maxMedio) * 100)}%` }} />
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel titulo="Comisión del centro" bajada="Se descuenta en cada liquidación, junto con los arriendos de box.">
                <p className="m-0 mt-4 text-[34px] font-black tracking-[-0.03em] tabular-nums">
                  {String(configuracion.data?.comisionCentroPorcentaje ?? '…')}%
                </p>
                <p className="m-0 mt-1 text-[13.5px] font-semibold text-neutral-800">sobre lo cobrado en el período, igual para todas las sesiones.</p>
                {rol === 'ADMIN' && (
                  <Link
                    href="/admin/configuracion?vista=cobros"
                    className="mt-3 inline-block text-[13px] font-extrabold text-accent-700 underline underline-offset-2"
                  >
                    Cambiar en Configuración
                  </Link>
                )}
              </Panel>
            </div>
          </div>
        );
      }}
    </EstadoConsulta>
  );
}
