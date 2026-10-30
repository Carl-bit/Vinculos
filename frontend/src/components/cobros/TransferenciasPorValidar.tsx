'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pestanas } from '@/components/ui/Pestanas';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro } from '@/lib/centro';
import { useTransferencias, type EstadoTransferencia, type TransferenciaVista } from '@/lib/cobros';
import { descargarArchivo } from '@/lib/descargas';
import { formatoClp, formatoFechaHora } from '@/lib/formato';
import { nombreDeCita, nombresPacientes, useEquipoAgenda, usePacientes } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

const ESTADOS: { valor: EstadoTransferencia; etiqueta: string }[] = [
  { valor: 'POR_VALIDAR', etiqueta: 'Por validar' },
  { valor: 'VALIDADA', etiqueta: 'Validadas' },
  { valor: 'RECHAZADA', etiqueta: 'Rechazadas' },
];

type Accion = { tipo: 'validar' | 'rechazar'; transferencia: TransferenciaVista };

/**
 * Transferencias de pacientes (03b-3.1). Quien valida depende del modelo de
 * cobro: administracion lo del centro, el profesional lo suyo con cobro directo
 * (la BD lo impone; aca solo se ocultan los botones que darian 403). Validar
 * registra el pago y confirma la hora; rechazar exige motivo y avisa al paciente.
 */
export function TransferenciasPorValidar({ rol }: { rol: Rol }) {
  const [estado, setEstado] = useState<EstadoTransferencia>('POR_VALIDAR');
  const [accion, setAccion] = useState<Accion | null>(null);
  const [aviso, setAviso] = useState<string>();
  const transferencias = useTransferencias(estado);
  const configuracion = useConfiguracionCentro();
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const modelo = configuracion.data?.modeloCobro;
  const valida = !!modelo && (modelo === 'MIXTO' || (modelo === 'CENTRO') === esAdministracion(rol));
  const paciente = (t: TransferenciaVista) => (t.pacienteId ? nombreDeCita(nombres, t) : 'Reserva sin cuenta');

  const verComprobante = async (t: TransferenciaVista) => {
    const r = await descargarArchivo(`/api/cobros/transferencias/${t.id}/comprobante`, 'comprobante');
    setAviso(r === 'listo' ? undefined : 'No pudimos abrir el comprobante. Intenta de nuevo.');
  };

  return (
    <div className="flex flex-col gap-4">
      <Aviso tono="info">Revisa que el dinero haya llegado a la cuenta antes de validar. El paciente recibe un aviso con el resultado.</Aviso>
      {aviso && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {aviso}
        </p>
      )}
      <Pestanas etiqueta="Estado de la transferencia" tono="team" valor={estado} onChange={setEstado} pestanas={ESTADOS} />
      <EstadoConsulta consulta={transferencias} vacio={(l) => l.length === 0} textoVacio="No hay transferencias en este estado">
        {(lista) => (
          <Tabla etiqueta="Transferencias">
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Profesional</Th>
                <Th>Sesión</Th>
                <Th className="text-right">Valor sesión</Th>
                <Th>{estado === 'RECHAZADA' ? 'Motivo' : 'Plazo'}</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => (
                <tr key={t.id} className="transition-colors duration-200 hover:bg-accent-100">
                  <Td className="font-extrabold">{paciente(t)}</Td>
                  <Td className="font-semibold">{profesional.get(t.profesionalId) ?? 'Profesional'}</Td>
                  <Td className="font-semibold text-neutral-800">{formatoFechaHora(t.inicio)}</Td>
                  <Td className="text-right font-bold tabular-nums">{t.monto === null ? '—' : formatoClp(t.monto)}</Td>
                  <Td className="font-semibold text-neutral-800">
                    {estado === 'RECHAZADA' ? t.motivoRechazo : t.pagoVenceEn ? formatoFechaHora(t.pagoVenceEn) : 'Sin plazo'}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {t.comprobanteRecibido ? (
                        <Button variant="ghost" icon="receipt_long" onClick={() => void verComprobante(t)} className="!px-3.5 !py-2 !text-[12.5px]">
                          Ver comprobante
                        </Button>
                      ) : (
                        <span className="self-center text-[12.5px] font-semibold text-neutral-700">Sin comprobante</span>
                      )}
                      {valida && estado === 'POR_VALIDAR' && (
                        <>
                          <Button
                            variant="ghost"
                            icon="close"
                            onClick={() => setAccion({ tipo: 'rechazar', transferencia: t })}
                            className="!px-3.5 !py-2 !text-[12.5px]"
                          >
                            Rechazar
                          </Button>
                          <Button
                            variant="team"
                            icon="check"
                            onClick={() => setAccion({ tipo: 'validar', transferencia: t })}
                            className="!px-3.5 !py-2 !text-[12.5px]"
                          >
                            Validar
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </EstadoConsulta>
      {accion && (
        <ResolverTransferencia key={accion.transferencia.id} accion={accion} paciente={paciente(accion.transferencia)} onCerrar={() => setAccion(null)} />
      )}
    </div>
  );
}

function ResolverTransferencia({ accion, paciente, onCerrar }: { accion: Accion; paciente: string; onCerrar: () => void }) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const { tipo, transferencia: t } = accion;
  const rechazar = tipo === 'rechazar';
  const path = { path: { id: t.citaId } };
  const resolver = useMutation({
    mutationFn: () =>
      datos(
        rechazar
          ? api.POST('/api/cobros/citas/{id}/transferencia/rechazo', { params: path, body: { motivo: motivo.trim() } })
          : api.POST('/api/cobros/citas/{id}/transferencia/validacion', { params: path }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel'] });
      onCerrar();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'No pudimos guardar la decisión.');
      // Otra persona pudo resolverla: la lista debe mostrar el estado real.
      void cliente.invalidateQueries({ queryKey: ['panel', 'cobros', 'transferencias'] });
    },
  });
  const enviar = () => {
    if (rechazar && motivo.trim().length < 3) return setError('Escribe el motivo: el paciente lo recibe en su aviso.');
    setError(undefined);
    resolver.mutate();
  };
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={rechazar ? 'Rechazar transferencia' : 'Validar transferencia'}
      descripcion={`${paciente} · ${formatoFechaHora(t.inicio)}`}
      acciones={
        <>
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="team" icon={rechazar ? 'close' : 'check'} loading={resolver.isPending} onClick={enviar}>
            {rechazar ? 'Rechazar' : 'Validar y registrar pago'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {rechazar ? (
          <Field label="Motivo del rechazo" required hint="Lo recibe el paciente. No escribas datos clínicos.">
            {(p) => <Textarea {...p} maxLength={300} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Field>
        ) : (
          <p className="m-0 text-[14px] font-semibold text-neutral-800">
            Se registra el pago por transferencia y, si la hora estaba pendiente, queda confirmada.
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
