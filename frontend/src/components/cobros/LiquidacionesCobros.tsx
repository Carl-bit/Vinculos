'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { ESTADO_LIQUIDACION, useLiquidaciones, type Periodo } from '@/lib/cobros';
import { useProfesionales } from '@/lib/consultas';
import { descargarArchivo } from '@/lib/descargas';
import { formatoClp, formatoFecha } from '@/lib/formato';
import { sumarDias, useEspacios } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

/** Periodo [desde, hasta) mostrado con el ultimo dia incluido. */
const rango = (desde: string, hasta: string) => `${formatoFecha(desde.slice(0, 10))} al ${formatoFecha(sumarDias(hasta.slice(0, 10), -1))}`;

/**
 * Liquidaciones: total = cobrado (pagos menos devoluciones del periodo) -
 * comision del centro - arriendos. BORRADOR se recalcula al generarla de
 * nuevo; EMITIDA y PAGADA quedan fijas (la BD lo exige). El profesional ve
 * las suyas ya emitidas. Arriendos de box: ADMIN/GESTION.
 */
export function LiquidacionesCobros({ periodo, rol }: { periodo: Periodo; rol: Rol }) {
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const lista = useLiquidaciones(admin ? (profesionalId ?? undefined) : undefined);
  const profesionales = useProfesionales(true);
  const nombre = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const cliente = useQueryClient();
  const [generar, setGenerar] = useState(false);
  const [error, setError] = useState<string>();
  const avanzar = useMutation({
    mutationFn: ({ id, paso }: { id: string; paso: 'emision' | 'pago' }) =>
      paso === 'emision'
        ? datos(api.POST('/api/cobros/liquidaciones/{id}/emision', { params: { path: { id } } }))
        : datos(api.POST('/api/cobros/liquidaciones/{id}/pago', { params: { path: { id } } })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['panel', 'cobros', 'liquidaciones'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos actualizar la liquidación.'),
  });
  const pdf = async (id: string) => {
    const r = await descargarArchivo(`/api/cobros/liquidaciones/${id}/pdf`, 'liquidacion.pdf');
    if (r !== 'listo') setError('No pudimos descargar el PDF de la liquidación.');
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        titulo="Liquidaciones"
        bajada="Cobrado menos comisión del centro y arriendos de box. Al emitirla queda fija."
        accion={
          admin ? (
            <Button variant="team" icon="receipt_long" onClick={() => setGenerar(true)} className="!py-2.5">
              Generar liquidación
            </Button>
          ) : undefined
        }
      >
        <div className="mt-4">
          <EstadoConsulta
            consulta={lista}
            vacio={(l) => l.length === 0}
            textoVacio={admin ? 'Todavía no hay liquidaciones' : 'Todavía no tienes liquidaciones emitidas'}
          >
            {(l) => (
              <Tabla etiqueta="Liquidaciones">
                <thead>
                  <tr>
                    <Th>Profesional</Th>
                    <Th>Período</Th>
                    <Th className="text-right">Cobrado</Th>
                    <Th className="text-right">Comisión</Th>
                    <Th className="text-right">Arriendos</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Estado</Th>
                    <Th>
                      <span className="sr-only">Acciones</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {l.map((q) => {
                    const e = ESTADO_LIQUIDACION[q.estado];
                    return (
                      <tr key={q.id}>
                        <Td className="font-extrabold">{nombre.get(q.profesionalId) ?? 'Profesional'}</Td>
                        <Td className="font-semibold text-neutral-800">{rango(String(q.periodoDesde), String(q.periodoHasta))}</Td>
                        <Td className="text-right font-bold tabular-nums">{formatoClp(q.totalCobrado)}</Td>
                        <Td className="text-right font-bold tabular-nums">
                          {formatoClp(q.comision)} <span className="text-[12px] text-neutral-700">({String(q.comisionPorcentaje)}%)</span>
                        </Td>
                        <Td className="text-right font-bold tabular-nums">{formatoClp(q.arriendos)}</Td>
                        <Td className="text-right font-black tabular-nums">{formatoClp(q.total)}</Td>
                        <Td>
                          <Badge tono={e.tono}>{e.texto}</Badge>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button variant="ghost" icon="picture_as_pdf" onClick={() => void pdf(q.id)} className="!px-3 !py-2 !text-[12.5px]">
                              PDF
                            </Button>
                            {admin && q.estado === 'BORRADOR' && (
                              <Button
                                variant="ghost"
                                icon="check"
                                onClick={() => avanzar.mutate({ id: q.id, paso: 'emision' })}
                                className="!px-3 !py-2 !text-[12.5px]"
                              >
                                Emitir
                              </Button>
                            )}
                            {admin && q.estado === 'EMITIDA' && (
                              <Button
                                variant="ghost"
                                icon="payments"
                                onClick={() => avanzar.mutate({ id: q.id, paso: 'pago' })}
                                className="!px-3 !py-2 !text-[12.5px]"
                              >
                                Marcar pagada
                              </Button>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabla>
            )}
          </EstadoConsulta>
          {error && (
            <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
        </div>
      </Panel>
      {admin && <Arriendos />}
      {admin && <GenerarLiquidacion abierto={generar} onCerrar={() => setGenerar(false)} periodo={periodo} profesionalInicial={profesionalId ?? ''} />}
    </div>
  );
}

function GenerarLiquidacion({
  abierto,
  onCerrar,
  periodo,
  profesionalInicial,
}: {
  abierto: boolean;
  onCerrar: () => void;
  periodo: Periodo;
  profesionalInicial: string;
}) {
  const profesionales = useProfesionales(true);
  const cliente = useQueryClient();
  const [profesionalId, setProfesionalId] = useState(profesionalInicial);
  const [desde, setDesde] = useState(periodo.desde);
  const [hasta, setHasta] = useState(sumarDias(periodo.hasta, -1));
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () => datos(api.POST('/api/cobros/liquidaciones', { body: { profesionalId, desde, hasta: sumarDias(hasta, 1) } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'cobros', 'liquidaciones'] });
      setError(undefined);
      onCerrar();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? 'Ya hay una liquidación emitida que se cruza con ese período.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos generar la liquidación.',
      ),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!profesionalId) return setError('Elige un profesional.');
    if (hasta < desde) return setError('La fecha de término debe ser igual o posterior a la de inicio.');
    crear.mutate();
  };
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Generar liquidación"
      descripcion="Queda en borrador: si la generas de nuevo para el mismo período, se recalcula."
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Field label="Profesional" required>
          {(p) => (
            <Select {...p} value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
              <option value="">Elige un profesional</option>
              {profesionales.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre ?? 'Profesional'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Desde" required>
            {(p) => <Input {...p} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />}
          </Field>
          <Field label="Hasta (inclusive)" required>
            {(p) => <Input {...p} type="date" min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} />}
          </Field>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" variant="team" loading={crear.isPending}>
            Generar borrador
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Arriendos de box por periodo: se descuentan en la liquidacion del profesional. */
function Arriendos() {
  const { profesionalId } = useEquipoActivo();
  const lista = useQuery({
    queryKey: ['panel', 'cobros', 'arriendos', profesionalId ?? 'todos'],
    queryFn: () => datos(api.GET('/api/cobros/arriendos', { params: { query: { profesionalId: profesionalId ?? undefined } } })),
  });
  const profesionales = useProfesionales(true);
  const espacios = useEspacios();
  const nombre = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const box = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const cliente = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ profesionalId: '', espacioId: '', desde: '', hasta: '', monto: '' });
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/cobros/arriendos', {
          body: { profesionalId: f.profesionalId, espacioId: f.espacioId || undefined, desde: f.desde, hasta: sumarDias(f.hasta, 1), monto: Number(f.monto) },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'cobros', 'arriendos'] });
      setAbierto(false);
      setError(undefined);
      setF({ profesionalId: '', espacioId: '', desde: '', hasta: '', monto: '' });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos registrar el arriendo.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!f.profesionalId || !f.desde || !f.hasta || !f.monto) return setError('Completa profesional, período y monto.');
    if (f.hasta < f.desde) return setError('La fecha de término debe ser igual o posterior a la de inicio.');
    crear.mutate();
  };
  return (
    <Panel
      titulo="Arriendos de box"
      bajada="Lo que paga cada profesional por usar un box en un período."
      accion={
        <Button variant="secondary" icon="add" onClick={() => setAbierto(true)} className="!py-2.5">
          Registrar arriendo
        </Button>
      }
    >
      <div className="mt-4">
        <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Sin arriendos registrados">
          {(l) => (
            <Tabla etiqueta="Arriendos de box">
              <thead>
                <tr>
                  <Th>Profesional</Th>
                  <Th>Box</Th>
                  <Th>Período</Th>
                  <Th className="text-right">Monto</Th>
                </tr>
              </thead>
              <tbody>
                {l.map((a) => (
                  <tr key={a.id}>
                    <Td className="font-extrabold">{nombre.get(a.profesionalId) ?? 'Profesional'}</Td>
                    <Td className="font-semibold">{a.espacioId ? (box.get(a.espacioId) ?? 'Box') : 'Cualquiera'}</Td>
                    <Td className="font-semibold text-neutral-800">{rango(String(a.periodoDesde), String(a.periodoHasta))}</Td>
                    <Td className="text-right font-bold tabular-nums">{formatoClp(a.monto)}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </EstadoConsulta>
      </div>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Registrar arriendo de box">
        <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
          <Field label="Profesional" required>
            {(p) => (
              <Select {...p} value={f.profesionalId} onChange={(e) => setF((x) => ({ ...x, profesionalId: e.target.value }))}>
                <option value="">Elige un profesional</option>
                {profesionales.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre ?? 'Profesional'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Box (opcional)">
            {(p) => (
              <Select {...p} value={f.espacioId} onChange={(e) => setF((x) => ({ ...x, espacioId: e.target.value }))}>
                <option value="">Cualquiera</option>
                {espacios.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Desde" required>
              {(p) => <Input {...p} type="date" value={f.desde} onChange={(e) => setF((x) => ({ ...x, desde: e.target.value }))} />}
            </Field>
            <Field label="Hasta (inclusive)" required>
              {(p) => <Input {...p} type="date" min={f.desde} value={f.hasta} onChange={(e) => setF((x) => ({ ...x, hasta: e.target.value }))} />}
            </Field>
          </div>
          <Field label="Monto (CLP)" required>
            {(p) => <Input {...p} inputMode="numeric" value={f.monto} onChange={(e) => setF((x) => ({ ...x, monto: e.target.value.replace(/\D/g, '') }))} />}
          </Field>
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2.5">
            <Button variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="team" loading={crear.isPending}>
              Registrar
            </Button>
          </div>
        </form>
      </Modal>
    </Panel>
  );
}
