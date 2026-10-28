'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Aviso } from '@/components/ui/Aviso';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { ESTADO_EXPORTACION } from '@/lib/exportaciones';
import { formatoFecha, formatoFechaHora } from '@/lib/formato';
import { usePacientes } from '@/lib/panel';

type Solicitud = components['schemas']['SolicitudDerechoVista'];
type Tipo = Solicitud['tipo'];
type Canal = components['schemas']['RegistrarSolicitudDerechoDto']['canal'];

const TIPOS: Record<Tipo, string> = {
  ACCESO: 'Acceso',
  RECTIFICACION: 'Rectificación',
  CANCELACION: 'Cancelación',
  OPOSICION: 'Oposición',
  PORTABILIDAD: 'Portabilidad',
  BLOQUEO: 'Bloqueo',
};
const CANALES: Record<Solicitud['canal'], string> = {
  PRESENCIAL: 'Presencial',
  CORREO: 'Correo',
  PORTAL: 'Portal del paciente',
  FORMULARIO_PUBLICO: 'Formulario público',
};
const ESTADOS: Record<Solicitud['estado'], { texto: string; tono: TonoBadge }> = {
  RECIBIDA: { texto: 'Recibida', tono: 'atencion' },
  EN_CURSO: { texto: 'En curso', tono: 'atencion' },
  RESUELTA: { texto: 'Resuelta', tono: 'positivo' },
  RECHAZADA: { texto: 'Rechazada', tono: 'neutro' },
};

/**
 * AUD-01 (E2.3a, ARCOP-01): solicitudes de derechos de los titulares (Ley
 * 21.719). El plazo son 30 dias habiles desde la recepcion (lo calcula la BD
 * con los feriados); faltando 5 dias habiles o menos aparece una alerta en el
 * inicio. Cerrar exige la respuesta enviada al titular. Solo ADMIN.
 */
export function SolicitudesDerechos() {
  const cliente = useQueryClient();
  const solicitudes = useQuery({ queryKey: ['derechos'], queryFn: () => datos(api.GET('/api/derechos/solicitudes')) });
  const [buscar, setBuscar] = useState('');
  const pacientes = usePacientes({ nombre: buscar.trim() || undefined }, buscar.trim().length >= 2);
  const [tipo, setTipo] = useState<Tipo>('ACCESO');
  const [canal, setCanal] = useState<Canal>('PRESENCIAL');
  const [pacienteId, setPacienteId] = useState('');
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState<string>();
  const listo = () => {
    setError(undefined);
    void cliente.invalidateQueries({ queryKey: ['derechos'] });
  };
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);
  const registrar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/derechos/solicitudes', {
          body: { tipo, canal, pacienteId: pacienteId || undefined, detalle: detalle.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      setDetalle('');
      setPacienteId('');
      setBuscar('');
      listo();
    },
    onError: fallo('No pudimos registrar la solicitud.'),
  });

  return (
    <div className="flex flex-col gap-6">
      <Panel
        titulo="Registrar una solicitud"
        bajada="Acceso, rectificación, cancelación, oposición, portabilidad o bloqueo de datos personales. El plazo para responder es de 30 días hábiles."
      >
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Derecho">
            {(p) => (
              <Select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
                {(Object.keys(TIPOS) as Tipo[]).map((t) => (
                  <option key={t} value={t}>
                    {TIPOS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Cómo llegó">
            {(p) => (
              <Select {...p} value={canal} onChange={(e) => setCanal(e.target.value as Canal)}>
                {(['PRESENCIAL', 'CORREO', 'PORTAL'] as const).map((c) => (
                  <option key={c} value={c}>
                    {CANALES[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Buscar paciente" hint="Opcional: el titular puede no ser paciente. Escribe al menos 2 letras.">
            {(p) => <Input {...p} value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
          </Field>
          <Field label="Paciente">
            {(p) => (
              <Select {...p} value={pacienteId} onChange={(e) => setPacienteId(e.target.value)}>
                <option value="">Sin paciente asociado</option>
                {(pacientes.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre} {x.apellido}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Detalle" hint="Qué pide el titular. Se guarda cifrado.">
            {(p) => <Textarea {...p} rows={3} maxLength={2000} value={detalle} onChange={(e) => setDetalle(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="team" icon="add" loading={registrar.isPending} onClick={() => registrar.mutate()}>
            Registrar solicitud
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 mt-2 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </Panel>

      <Panel titulo="Solicitudes" bajada="Ordenadas por vencimiento. Faltando 5 días hábiles o menos, el inicio muestra una alerta.">
        <div className="mt-4">
          <EstadoConsulta consulta={solicitudes} vacio={(s) => s.length === 0} textoVacio="No hay solicitudes registradas">
            {(lista) => (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {lista.map((s) => (
                  <FilaSolicitud key={s.id} s={s} onCambio={listo} />
                ))}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}

function FilaSolicitud({ s, onCambio }: { s: Solicitud; onCambio: () => void }) {
  const abierta = s.estado === 'RECIBIDA' || s.estado === 'EN_CURSO';
  const [respuesta, setRespuesta] = useState('');
  const [error, setError] = useState<string>();
  const avanzar = useMutation({
    mutationFn: (estado: 'EN_CURSO' | 'RESUELTA' | 'RECHAZADA') =>
      datos(api.POST('/api/derechos/solicitudes/{id}/estado', { params: { path: { id: s.id } }, body: { estado, respuesta: respuesta.trim() || undefined } })),
    onSuccess: () => {
      setError(undefined);
      onCambio();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos actualizar la solicitud.'),
  });
  const urgente = abierta && s.diasHabilesRestantes !== null && s.diasHabilesRestantes <= 5;
  const [confirmarCancelacion, setConfirmarCancelacion] = useState(false);
  const exportar = useMutation({
    mutationFn: () => datos(api.POST('/api/derechos/solicitudes/{id}/exportacion', { params: { path: { id: s.id } } })),
    onSuccess: () => {
      setError(undefined);
      onCambio();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos preparar la exportación.'),
  });
  const [resultado, setResultado] = useState<string>();
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);
  const bloqueo = useMutation({
    mutationFn: (accion: 'bloquear' | 'levantar') =>
      accion === 'bloquear'
        ? datos(
            api.POST('/api/derechos/pacientes/{id}/bloqueo', {
              params: { path: { id: s.pacienteId! } },
              body: { motivo: `Solicitud de ${TIPOS[s.tipo].toLowerCase()} en curso`, solicitudId: s.id },
            }),
          )
        : datos(api.POST('/api/derechos/pacientes/{id}/bloqueo/levantamiento', { params: { path: { id: s.pacienteId! } } })),
    onSuccess: () => {
      setError(undefined);
      onCambio();
    },
    onError: fallo('No pudimos cambiar el bloqueo.'),
  });
  const cancelar = useMutation({
    mutationFn: () => datos(api.POST('/api/derechos/pacientes/{id}/cancelacion', { params: { path: { id: s.pacienteId! } }, body: { solicitudId: s.id } })),
    onSuccess: (r) => {
      setConfirmarCancelacion(false);
      setResultado(r.mensaje);
      setRespuesta(r.mensaje);
      setError(undefined);
      onCambio();
    },
    onError: fallo('No pudimos aplicar la cancelación.'),
  });
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-divider px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-extrabold">{TIPOS[s.tipo]}</span>
        <Badge tono={ESTADOS[s.estado].tono}>{ESTADOS[s.estado].texto}</Badge>
        {s.pacienteBloqueado && <Badge tono="atencion">Tratamiento bloqueado</Badge>}
        {s.pideCambioCorreo && abierta && <Badge tono="atencion">Pide cambiar su correo: verificar identidad</Badge>}
        {abierta && (
          <Badge tono={urgente ? 'atencion' : 'neutro'}>
            Vence el {formatoFecha(s.venceEl)} · {s.diasHabilesRestantes} días hábiles
          </Badge>
        )}
      </div>
      <p className="m-0 text-[13px] font-semibold text-neutral-800">
        {s.pacienteNombre ?? 'Titular sin paciente asociado'} · {CANALES[s.canal]} · recibida el {formatoFecha(s.recibidaEn)}
      </p>
      {s.detalle && <p className="m-0 text-[13.5px]">{s.detalle}</p>}
      {s.exportacion && (
        <p className="m-0 text-[13px] font-semibold text-neutral-800">
          Copia de datos: {ESTADO_EXPORTACION[s.exportacion.estado]}
          {s.exportacion.venceEn && s.exportacion.estado === 'ENVIADA' ? ` · vence ${formatoFechaHora(s.exportacion.venceEn)}` : ''}
          {s.exportacion.descargas > 0 ? ` · descargada ${s.exportacion.descargas} ${s.exportacion.descargas === 1 ? 'vez' : 'veces'}` : ''}
        </p>
      )}
      {s.respuesta && <p className="m-0 text-[13.5px] text-neutral-800">Respuesta: {s.respuesta}</p>}
      {abierta && (
        <div className="flex flex-col gap-2">
          <Field label="Respuesta al titular" hint="Obligatoria para resolver o rechazar. Se guarda cifrada.">
            {(p) => <Textarea {...p} rows={2} maxLength={4000} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {s.pacienteId && (
              <Button
                variant="ghost"
                icon="lock"
                loading={bloqueo.isPending}
                onClick={() => bloqueo.mutate(s.pacienteBloqueado ? 'levantar' : 'bloquear')}
              >
                {s.pacienteBloqueado ? 'Levantar bloqueo' : 'Bloquear tratamiento'}
              </Button>
            )}
            {s.pacienteId && (s.tipo === 'ACCESO' || s.tipo === 'PORTABILIDAD') && !s.exportacion && (
              <Button variant="ghost" icon="description" loading={exportar.isPending} onClick={() => exportar.mutate()}>
                Preparar copia de datos
              </Button>
            )}
            {s.pacienteId && s.tipo === 'CANCELACION' && (
              <Button variant="ghost" icon="delete" onClick={() => setConfirmarCancelacion(true)}>
                Aplicar cancelación
              </Button>
            )}
            {s.estado === 'RECIBIDA' && (
              <Button variant="ghost" loading={avanzar.isPending && avanzar.variables === 'EN_CURSO'} onClick={() => avanzar.mutate('EN_CURSO')}>
                Marcar en curso
              </Button>
            )}
            <Button variant="ghost" loading={avanzar.isPending && avanzar.variables === 'RECHAZADA'} onClick={() => avanzar.mutate('RECHAZADA')}>
              Rechazar
            </Button>
            <Button variant="team" loading={avanzar.isPending && avanzar.variables === 'RESUELTA'} onClick={() => avanzar.mutate('RESUELTA')}>
              Resolver
            </Button>
          </div>
        </div>
      )}
      {resultado && <Aviso tono="exito">{resultado}</Aviso>}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <Modal
        abierto={confirmarCancelacion}
        onCerrar={() => setConfirmarCancelacion(false)}
        titulo="Aplicar la cancelación"
        descripcion="Se borran el correo, el teléfono, el contacto de emergencia, las preferencias de aviso, las respuestas del match y la cuenta del portal. No se puede deshacer. La ficha clínica y la identificación (nombre, RUT y fecha de nacimiento) se conservan por obligación legal."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmarCancelacion(false)}>
              Volver
            </Button>
            <Button variant="team" loading={cancelar.isPending} onClick={() => cancelar.mutate()}>
              Aplicar cancelación
            </Button>
          </>
        }
      />
    </li>
  );
}
