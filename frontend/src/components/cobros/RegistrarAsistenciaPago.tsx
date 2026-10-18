'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { ESTADO_PAGO, MEDIO_PAGO, useDetalleCobro, type MedioPago } from '@/lib/cobros';
import { useConfiguracionCentro } from '@/lib/centro';
import { formatoClp, formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { hoyChile, useCitas } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

const MEDIOS: { valor: MedioPago; icono: Icono }[] = [
  { valor: 'EFECTIVO', icono: 'payments' },
  { valor: 'TRANSFERENCIA', icono: 'account_balance' },
  { valor: 'TARJETA_DEBITO', icono: 'credit_card' },
  { valor: 'TARJETA_CREDITO', icono: 'credit_card' },
  { valor: 'CONVENIO', icono: 'assignment' },
];

/**
 * "Registrar asistencia y pago" (antes "cerrar sesion" en el diseño de
 * Cobros): el monto lo fijo la BD al confirmar la cita y no se edita. Si el
 * paciente asistio se registra el pago (total o parcial; el sobrepago lo
 * rechaza la BD); si no, la inasistencia aplica el porcentaje del centro. Una
 * cita cancelada se resuelve con devolucion o traslado a otra cita. La boleta
 * sale sola cuando la cita queda pagada.
 */
export function RegistrarAsistenciaPago({
  citaId,
  nombrePaciente,
  nombreProfesional,
  rol,
  onCerrar,
}: {
  citaId: string | null;
  nombrePaciente: string;
  nombreProfesional: string;
  rol: Rol;
  onCerrar: () => void;
}) {
  const detalle = useDetalleCobro(citaId);
  const configuracion = useConfiguracionCentro();
  const cliente = useQueryClient();
  const admin = esAdministracion(rol);
  const [asistio, setAsistio] = useState<boolean | null>(null);
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('TRANSFERENCIA');
  const [motivo, setMotivo] = useState('');
  const [traslado, setTraslado] = useState('');
  const [anulando, setAnulando] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const d = detalle.data;
  const futuras = useCitas({ pacienteId: d?.paciente_id, desde: hoyChile().desde }, !!d && d.estado_cita === 'CANCELADA');

  const cerrar = () => {
    setAsistio(null);
    setMonto('');
    setMotivo('');
    setTraslado('');
    setAnulando(null);
    setError(undefined);
    onCerrar();
  };
  const refrescar = () => {
    void cliente.invalidateQueries({ queryKey: ['panel', 'cobros'] });
    setError(undefined);
  };
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);

  const pagar = useMutation({
    mutationFn: () => datos(api.POST('/api/cobros/citas/{id}/pagos', { params: { path: { id: citaId! } }, body: { monto: Number(monto), medioPago: medio } })),
    onSuccess: () => {
      refrescar();
      setMonto('');
      setAsistio(null);
    },
    onError: fallo('No pudimos registrar el pago.'),
  });
  const resolver = useMutation({
    mutationFn: (decision: 'INASISTENCIA' | 'DEVOLUCION' | 'TRASLADO') =>
      datos(
        api.POST('/api/cobros/citas/{id}/resolucion', {
          params: { path: { id: citaId! } },
          body: { decision, motivo: motivo.trim() || undefined, citaNuevaId: decision === 'TRASLADO' ? traslado : undefined },
        }),
      ),
    onSuccess: () => {
      refrescar();
      setAsistio(null);
    },
    onError: fallo('No pudimos registrar la decisión.'),
  });
  const anular = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/cobros/pagos/{id}/anulacion', { params: { path: { id } }, body: { motivo: motivo.trim() } })),
    onSuccess: () => {
      refrescar();
      setAnulando(null);
      setMotivo('');
    },
    onError: fallo('No pudimos anular el pago.'),
  });

  const registrar = () => {
    const n = Number(monto);
    if (!Number.isInteger(n) || n < 1) return setError('Escribe un monto entero en pesos.');
    if (d && n > d.saldo) return setError(`El saldo es ${formatoClp(d.saldo)}: no se puede pagar más.`);
    pagar.mutate();
  };

  return (
    <Modal abierto={!!citaId} onCerrar={cerrar} ancho="lg" titulo={`Registrar asistencia y pago · ${nombrePaciente}`}>
      <EstadoConsulta consulta={detalle}>
        {(c) => {
          const pasada = new Date(c.fin).getTime() < Date.now();
          const resuelta = !!c.resolucion;
          const e = ESTADO_PAGO[c.estado_pago];
          return (
            <div className="flex flex-col gap-5">
              <p className="m-0 -mt-2 text-[13.5px] font-semibold text-neutral-800 first-letter:uppercase">
                {formatoFechaLarga(c.inicio)} · {formatoHora(c.inicio)} a {formatoHora(c.fin)} · {nombreProfesional}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Cifra etiqueta="Monto de la sesión" valor={c.monto !== null ? formatoClp(c.monto) : '—'} />
                <Cifra etiqueta="Exigible" valor={formatoClp(c.exigible)} />
                <Cifra etiqueta="Pagado" valor={formatoClp(c.pagado)} />
                <Cifra etiqueta="Saldo" valor={formatoClp(c.saldo)} destacado={c.saldo > 0} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tono={e.tono}>{e.texto}</Badge>
                {c.estado_cita === 'CANCELADA' && <Badge tono="neutro">Cita cancelada</Badge>}
                {c.resolucion && (
                  <Badge tono="neutro">
                    {c.resolucion.decision === 'INASISTENCIA' ? 'No asistió' : c.resolucion.decision === 'DEVOLUCION' ? 'Devolución' : 'Trasladada'}
                  </Badge>
                )}
                {c.boleta && <span className="text-[12.5px] font-bold text-neutral-800">Boleta N° {c.boleta.numero} (simulada, sin SII)</span>}
              </div>

              {c.pagos.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Pagos</p>
                  {c.pagos.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-neutral-100 px-3.5 py-2 text-[13.5px] font-bold"
                    >
                      <span className="tabular-nums">{formatoClp(p.monto)}</span>
                      <span className="flex-1 font-semibold text-neutral-800">
                        {MEDIO_PAGO[p.medioPago]} · {formatoFechaLarga(p.fecha)}
                        {p.estado === 'ANULADO' && ` · anulado${p.motivoAnulacion ? `: ${p.motivoAnulacion}` : ''}`}
                      </span>
                      {admin && p.estado !== 'ANULADO' && !c.boleta && (
                        <button
                          type="button"
                          onClick={() => setAnulando(p.id)}
                          className="cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-extrabold text-accent-700 hover:bg-accent-200"
                        >
                          Anular
                        </button>
                      )}
                    </div>
                  ))}
                  {anulando && (
                    <div className="flex flex-col gap-2 rounded-[14px] border border-accent-500 bg-accent-100 p-3">
                      <Field label="Motivo de la anulación" required hint="El pago no se borra: queda anulado con este motivo.">
                        {(p) => <Input {...p} value={motivo} maxLength={500} onChange={(ev) => setMotivo(ev.target.value)} />}
                      </Field>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setAnulando(null)}>
                          Volver
                        </Button>
                        <Button variant="team" disabled={motivo.trim().length < 3} loading={anular.isPending} onClick={() => anular.mutate(anulando)}>
                          Anular pago
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {c.estado_cita !== 'CANCELADA' && !resuelta && c.saldo > 0 && (
                <div className="flex flex-col gap-4 rounded-lg border border-divider px-[18px] py-4">
                  {pasada && (
                    <div role="radiogroup" aria-label="Asistencia" className="flex flex-wrap gap-2">
                      {[
                        { v: true, t: 'Asistió', i: 'check_circle' as Icono },
                        { v: false, t: 'No asistió', i: 'cancel' as Icono },
                      ].map((o) => (
                        <button
                          key={o.t}
                          type="button"
                          role="radio"
                          aria-checked={asistio === o.v}
                          onClick={() => setAsistio(o.v)}
                          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-[18px] text-[13.5px] font-extrabold transition-colors duration-200 ${
                            asistio === o.v ? 'border-accent-700 bg-accent-200 text-accent-900' : 'border-neutral-400 bg-bg hover:border-accent-500'
                          }`}
                        >
                          <Icon name={o.i} size={18} />
                          {o.t}
                        </button>
                      ))}
                    </div>
                  )}
                  {(asistio === true || !pasada) && (
                    <>
                      <fieldset className="m-0 border-0 p-0">
                        <legend className="mb-2 text-[12.5px] font-extrabold">Método de pago</legend>
                        <div className="flex flex-wrap gap-2">
                          {MEDIOS.map((m) => (
                            <button
                              key={m.valor}
                              type="button"
                              aria-pressed={medio === m.valor}
                              onClick={() => setMedio(m.valor)}
                              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3.5 text-[13px] font-extrabold transition-colors duration-200 ${
                                medio === m.valor ? 'border-accent-700 bg-accent-200 text-accent-900' : 'border-neutral-400 bg-bg hover:border-accent-500'
                              }`}
                            >
                              <Icon name={m.icono} size={17} />
                              {MEDIO_PAGO[m.valor]}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <Field label="Monto recibido" required hint={`Saldo por pagar: ${formatoClp(c.saldo)}. Puede ser un abono parcial.`}>
                        {(p) => (
                          <Input
                            {...p}
                            inputMode="numeric"
                            placeholder={String(c.saldo)}
                            value={monto}
                            onChange={(ev) => setMonto(ev.target.value.replace(/\D/g, ''))}
                          />
                        )}
                      </Field>
                      <div className="flex flex-wrap justify-end gap-2.5">
                        <Button variant="ghost" onClick={() => setMonto(String(c.saldo))}>
                          Pago total
                        </Button>
                        <Button variant="team" icon="payments" loading={pagar.isPending} onClick={registrar}>
                          Registrar pago
                        </Button>
                      </div>
                    </>
                  )}
                  {asistio === false && (
                    <>
                      <Aviso tono="advertencia">
                        Se cobra el {String(configuracion.data?.cobroInasistenciaPorcentaje ?? '…')}% del monto por inasistencia (política del centro). La
                        decisión no se deshace.
                      </Aviso>
                      <Field label="Nota (opcional)">
                        {(p) => <Textarea {...p} rows={2} maxLength={500} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} className="!min-h-16" />}
                      </Field>
                      <div className="flex justify-end">
                        <Button variant="team" loading={resolver.isPending} onClick={() => resolver.mutate('INASISTENCIA')}>
                          Registrar inasistencia
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {c.estado_cita === 'CANCELADA' && !resuelta && admin && (
                <div className="flex flex-col gap-3.5 rounded-lg border border-divider px-[18px] py-4">
                  <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
                    Cita cancelada: decide qué pasa con lo pagado. Con aviso fuera de plazo se aplica la penalización del centro (
                    {String(configuracion.data?.penalizacionCancelacionPorcentaje ?? '…')}%).
                  </p>
                  <Field label="Trasladar a otra cita del paciente (opcional)">
                    {(p) => (
                      <Select {...p} value={traslado} onChange={(ev) => setTraslado(ev.target.value)}>
                        <option value="">Sin traslado: devolución</option>
                        {(futuras.data ?? [])
                          .filter((x) => x.estado === 'CONFIRMADA' && x.id !== c.cita_id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {formatoFechaLarga(x.inicio)}, {formatoHora(x.inicio)}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Nota (opcional)">{(p) => <Input {...p} value={motivo} maxLength={500} onChange={(ev) => setMotivo(ev.target.value)} />}</Field>
                  <div className="flex justify-end">
                    <Button variant="team" loading={resolver.isPending} onClick={() => resolver.mutate(traslado ? 'TRASLADO' : 'DEVOLUCION')}>
                      {traslado ? 'Trasladar lo pagado' : 'Registrar devolución'}
                    </Button>
                  </div>
                </div>
              )}

              {error && (
                <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                  {error}
                </p>
              )}
              <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Lo registrado se suma al reporte del período. Sin datos clínicos del paciente.</p>
            </div>
          );
        }}
      </EstadoConsulta>
    </Modal>
  );
}

function Cifra({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`rounded-[14px] border px-3.5 py-3 ${destacado ? 'border-accent-500 bg-accent-100' : 'border-divider bg-neutral-100'}`}>
      <div className="mb-1 text-[10.5px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{etiqueta}</div>
      <div className="text-[18px] font-black tracking-[-0.02em] tabular-nums">{valor}</div>
    </div>
  );
}
