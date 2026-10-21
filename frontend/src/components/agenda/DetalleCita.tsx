'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { MEDIO_PAGO, type MedioPago } from '@/lib/cobros';
import { useMiCuenta, useProfesionales } from '@/lib/consultas';
import { formatoFechaHora, formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { inicioDiaChile, sumarDias, useAccesosTemporales, useEquipoAgenda, useEspacios, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { NOMBRE_MODALIDAD_CITA } from './SelectorHorario';
import { NOMBRE_ESTADO_CITA } from './tonosAgenda';

const diaChile = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

/**
 * Detalle de una sesion del calendario. En vez de "reasignar" (diseño), dos
 * caminos segun la regla de un solo tratante (C-4/C-5):
 * - "Cubrir sesion" (ADMIN/GESTION): otro profesional atiende esta sesion,
 *   con acceso clinico temporal vigente en el horario (la BD lo exige). ADMIN
 *   puede otorgarlo aca mismo; GESTION no otorga accesos.
 * - "Derivar paciente": cambio definitivo de tratante, desde la ficha.
 *
 * 03b-3.2: la pendiente de pago muestra su plazo; se confirma con el pago
 * (portal, transferencia validada o pago registrado en Cobros). 03b-3.3: si
 * vence sin pago se mantiene y se paga en el centro. La hora retenida
 * (reserva sin cuenta en curso, sin paciente) se cobra en caja si es
 * presencial (crea paciente y ficha) o se libera con motivo (ADMIN/GESTION).
 */
export function DetalleCita({
  cita,
  nombrePaciente,
  rol,
  onCerrar,
  onReprogramar,
}: {
  cita: CitaVista | null;
  nombrePaciente: string;
  rol: Rol;
  onCerrar: () => void;
  onReprogramar: (c: CitaVista) => void;
}) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const equipo = useEquipoAgenda();
  const espacios = useEspacios();
  const [cancelando, setCancelando] = useState(false);
  const [cubriendo, setCubriendo] = useState(false);
  const [error, setError] = useState<string>();
  const admin = esAdministracion(rol);

  const cerrar = () => {
    setCancelando(false);
    setCubriendo(false);
    setError(undefined);
    onCerrar();
  };
  const listo = () => {
    void cliente.invalidateQueries({ queryKey: ['panel'] });
    void cliente.invalidateQueries({ queryKey: ['huecos'] });
    cerrar();
  };
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);

  const cancelar = useMutation({
    mutationFn: () => datos(api.PATCH('/api/citas/{id}/cancelacion', { params: { path: { id: cita!.id } } })),
    onSuccess: listo,
    onError: fallo('No pudimos cancelar la cita.'),
  });
  // ADMIN: aviso al profesional de que la sesion sigue sin evolucion (la cuenta madre no ve si la tiene: es clinico).
  const requerir = useMutation({
    mutationFn: () => datos(api.POST('/api/citas/{id}/cierre-requerido', { params: { path: { id: cita!.id } } })),
    onError: fallo('No pudimos enviar el aviso.'),
  });

  if (!cita) return null;
  const pasada = new Date(cita.fin).getTime() < Date.now();
  const profesional = equipo.data?.find((m) => m.id === cita.profesionalId)?.nombre ?? 'Profesional';
  const box = cita.espacioId ? (espacios.data?.find((e) => e.id === cita.espacioId)?.nombre ?? 'Box') : 'Sin box';
  const esTratante = rol === 'PROFESIONAL' && cuenta.data?.id === cita.profesionalId;
  const datosCita: { icono: Icono; etiqueta: string; valor: string }[] = [
    { icono: 'person', etiqueta: 'Profesional', valor: profesional },
    { icono: 'meeting_room', etiqueta: 'Espacio', valor: box },
    { icono: 'videocam', etiqueta: 'Modalidad', valor: NOMBRE_MODALIDAD_CITA[cita.modalidad] },
    { icono: 'flag', etiqueta: 'Estado', valor: NOMBRE_ESTADO_CITA[cita.estado] },
  ];

  return (
    <Modal
      abierto
      onCerrar={cerrar}
      titulo={nombrePaciente}
      descripcion={`${formatoFechaLarga(cita.inicio)} · ${formatoHora(cita.inicio)} a ${formatoHora(cita.fin)}`}
    >
      <div className="flex flex-col gap-5">
        <dl className="m-0 flex flex-col gap-3">
          {datosCita.map((d) => (
            <div key={d.etiqueta} className="flex items-center gap-[11px]">
              <Icon name={d.icono} size={18} className="flex-none text-neutral-700" />
              <dt className="w-[96px] flex-none text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{d.etiqueta}</dt>
              <dd className="m-0 text-[14px] font-extrabold tracking-[-0.01em]">{d.valor}</dd>
            </div>
          ))}
        </dl>

        {cita.estado === 'RETENIDA' && (
          <Aviso tono="info" titulo="Reserva en curso">
            Alguien pidió esta hora desde el sitio y está pagando{cita.pagoVenceEn ? ` (plazo: ${formatoFechaHora(cita.pagoVenceEn)})` : ''}. El paciente se
            crea con el pago validado; si no paga a tiempo, la hora se libera sola.
            {cita.modalidad === 'PRESENCIAL' && ' Si viene a pagar al centro, cóbrala acá.'}
          </Aviso>
        )}
        {cita.estado === 'PENDIENTE_PAGO' && (
          <Aviso tono="advertencia" titulo="Pago pendiente">
            Se confirma con el pago{cita.pagoVenceEn ? ` antes del ${formatoFechaHora(cita.pagoVenceEn)}` : ''}: el paciente paga desde su cuenta o se registra
            en Cobros. Si vence el plazo sin pago, la hora se mantiene y se paga en el centro.
          </Aviso>
        )}
        {cita.estado === 'POR_REPROGRAMAR' && (
          <Aviso tono="advertencia" titulo="Por reprogramar">
            El profesional ya no puede atender esta hora (salida, revocación o baja). Reprográmala con el tratante o cúbrela con otro profesional.
          </Aviso>
        )}

        {(admin || (esTratante && cita.modalidad === 'PRESENCIAL')) && cita.estado === 'RETENIDA' && (
          <HoraRetenida cita={cita} puedeLiberar={admin} onListo={listo} />
        )}

        {cita.estado === 'LIBERADA' && cita.motivoLiberacion && (
          <Aviso tono="info" titulo="Hora liberada por el centro">
            {cita.motivoLiberacion}
          </Aviso>
        )}

        {admin && cita.estado === 'CONFIRMADA' && !pasada && (
          <CubrirSesion cita={cita} rol={rol} abierto={cubriendo} onAbrir={() => setCubriendo(true)} onListo={listo} />
        )}

        {!pasada && cita.pacienteId && cita.estado !== 'CANCELADA' && (
          <div className="flex flex-col gap-2 rounded-lg border border-divider bg-neutral-100 px-[18px] py-4">
            <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Cambio definitivo de profesional</p>
            {esTratante ? (
              <>
                <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
                  Si el paciente debe seguir con otra persona, derívalo: al aceptar, la ficha se traspasa.
                </p>
                <ButtonLink href={`/admin/fichas/${cita.pacienteId}?derivar=1`} variant="secondary" icon="call_split" className="!py-2.5">
                  Derivar paciente
                </ButtonLink>
              </>
            ) : (
              <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
                Es una derivación y la inicia el tratante desde la ficha (o administración de oficio si el paciente está en la cola de reasignación).{' '}
                <a href={`/admin/fichas/${cita.pacienteId}`} className="font-extrabold text-accent-700 underline underline-offset-2">
                  Ver paciente
                </a>
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}

        {cita.estado === 'RETENIDA' ? null : pasada ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px] font-semibold text-neutral-700">Sesión ya ocurrida: la asistencia y el pago se registran en Cobros.</p>
            {rol === 'ADMIN' && cita.estado === 'CONFIRMADA' && (
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  variant="secondary"
                  icon="notifications"
                  loading={requerir.isPending}
                  disabled={requerir.isSuccess}
                  onClick={() => requerir.mutate()}
                  className="!py-2.5"
                >
                  Requerir cierre
                </Button>
                <span role="status" className="text-[12.5px] font-semibold text-neutral-800">
                  {requerir.isSuccess ? 'Avisamos al profesional.' : 'Avisa al profesional si la sesión sigue sin evolución registrada.'}
                </span>
              </div>
            )}
          </div>
        ) : cancelando ? (
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <span className="mr-auto text-[13.5px] font-extrabold">¿Cancelar esta cita? Se avisa al paciente.</span>
            <Button variant="ghost" onClick={() => setCancelando(false)}>
              No, volver
            </Button>
            <Button variant="team" loading={cancelar.isPending} onClick={() => cancelar.mutate()}>
              Sí, cancelar
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2.5">
            <Button variant="ghost" icon="event_busy" onClick={() => setCancelando(true)}>
              Cancelar cita
            </Button>
            <Button variant="secondary" icon="edit_calendar" onClick={() => onReprogramar(cita)}>
              Reprogramar
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const MEDIOS_CAJA: MedioPago[] = ['EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'CONVENIO'];

/**
 * Hora retenida desde el panel: cobrar en caja (solo presencial; cubre al
 * menos lo exigido para confirmar y crea paciente y ficha) lo hacen
 * ADMIN/GESTION o el profesional de la cita (03b-3.4: en la consulta se le
 * paga a el); liberarla con motivo, solo ADMIN/GESTION.
 */
function HoraRetenida({ cita, puedeLiberar, onListo }: { cita: CitaVista; puedeLiberar: boolean; onListo: () => void }) {
  const [modo, setModo] = useState<'caja' | 'liberar' | null>(null);
  const [monto, setMonto] = useState(String(cita.monto ?? ''));
  const [medio, setMedio] = useState<MedioPago>('EFECTIVO');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);

  const caja = useMutation({
    mutationFn: () => datos(api.POST('/api/cobros/citas/{id}/caja', { params: { path: { id: cita.id } }, body: { monto: Number(monto), medioPago: medio } })),
    onSuccess: onListo,
    onError: fallo('No pudimos registrar el pago.'),
  });
  const liberar = useMutation({
    mutationFn: () => datos(api.PATCH('/api/citas/{id}/liberacion', { params: { path: { id: cita.id } }, body: { motivo: motivo.trim() } })),
    onSuccess: onListo,
    onError: fallo('No pudimos liberar la hora.'),
  });

  if (!modo) {
    return (
      <div className="flex flex-wrap justify-end gap-2.5">
        {puedeLiberar && (
          <Button variant="ghost" icon="event_busy" onClick={() => setModo('liberar')}>
            Liberar hora
          </Button>
        )}
        {cita.modalidad === 'PRESENCIAL' && (
          <Button variant="secondary" icon="payments" onClick={() => setModo('caja')}>
            Cobrar en caja
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3.5 rounded-lg border border-accent-500 bg-accent-100 px-[18px] py-4">
      <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-accent-800 uppercase">{modo === 'caja' ? 'Cobrar en caja' : 'Liberar hora'}</p>
      {modo === 'caja' ? (
        <>
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
            Confirma con la persona la fecha, la hora y el profesional de su reserva. Al registrar el pago se crean el paciente y su ficha, la hora queda
            confirmada y le llega la invitación a su cuenta.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Monto" hint="Al menos lo exigido para confirmar, sin superar el valor de la sesión." required>
              {(p) => <Input {...p} inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} />}
            </Field>
            <Field label="Medio de pago" required>
              {(p) => (
                <Select {...p} value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
                  {MEDIOS_CAJA.map((m) => (
                    <option key={m} value={m}>
                      {MEDIO_PAGO[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </>
      ) : (
        <Field label="Motivo" hint="Queda registrado. La reserva ya no se puede confirmar." required>
          {(p) => <Textarea {...p} rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Field>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button
          variant="ghost"
          onClick={() => {
            setModo(null);
            setError(undefined);
          }}
        >
          Volver
        </Button>
        {modo === 'caja' ? (
          <Button variant="team" icon="payments" disabled={!Number(monto)} loading={caja.isPending} onClick={() => caja.mutate()}>
            Registrar pago y confirmar
          </Button>
        ) : (
          <Button variant="team" icon="event_busy" disabled={motivo.trim().length < 3} loading={liberar.isPending} onClick={() => liberar.mutate()}>
            Liberar hora
          </Button>
        )}
      </div>
    </div>
  );
}

function CubrirSesion({ cita, rol, abierto, onAbrir, onListo }: { cita: CitaVista; rol: Rol; abierto: boolean; onAbrir: () => void; onListo: () => void }) {
  const profesionales = useProfesionales(true);
  const otorga = rol === 'ADMIN';
  // Solo se cubre una cita CONFIRMADA: siempre tiene paciente.
  const accesos = useAccesosTemporales(cita.pacienteId ?? '', abierto && otorga && !!cita.pacienteId);
  const diaSesion = diaChile(new Date(cita.inicio));
  const [profesionalId, setProfesionalId] = useState('');
  const [hasta, setHasta] = useState(sumarDias(diaSesion, 7));
  const [error, setError] = useState<string>();
  const vigente = accesos.data?.some(
    (a) => a.profesionalId === profesionalId && new Date(a.desde) <= new Date(cita.inicio) && new Date(a.hasta) >= new Date(cita.fin),
  );
  const otorgar = otorga && !!profesionalId && accesos.isSuccess && !vigente;

  const cubrir = useMutation({
    // Una sola llamada: si otorga, la API otorga el acceso y mueve la cita en la misma transaccion.
    mutationFn: () =>
      datos(
        api.PATCH('/api/citas/{id}/profesional', {
          params: { path: { id: cita.id } },
          body: { profesionalId, ...(otorgar && { otorgarAccesoHasta: inicioDiaChile(sumarDias(hasta, 1)).toISOString() }) },
        }),
      ),
    onSuccess: onListo,
    onError: (e) =>
      setError(
        e instanceof ApiError && e.cuerpo.restriccion === 'citas_profesional_con_acceso'
          ? 'Ese profesional no tiene acceso clínico temporal en este horario. Lo otorga administración o el tratante del paciente.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos cubrir la sesión.',
      ),
  });

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-divider px-[18px] py-4">
        <p className="m-0 max-w-[300px] text-[13.5px] font-semibold text-neutral-800">
          ¿El profesional no puede atender esta sesión? Otra persona del equipo puede cubrirla.
        </p>
        <Button variant="secondary" icon="swap_horiz" onClick={onAbrir} className="!py-2.5">
          Cubrir sesión
        </Button>
      </div>
    );
  }
  const candidatos = (profesionales.data ?? []).filter((p) => p.id !== cita.profesionalId);
  return (
    <div className="flex flex-col gap-3.5 rounded-lg border border-accent-500 bg-accent-100 px-[18px] py-4">
      <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-accent-800 uppercase">Cubrir sesión</p>
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        Solo esta sesión: el tratante no cambia. Quien cubre necesita acceso clínico temporal vigente en el horario.
      </p>
      <Field label="Profesional que cubre" required>
        {(p) => (
          <Select {...p} value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
            <option value="">Elige un profesional</option>
            {candidatos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre ?? 'Profesional'}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {otorga && profesionalId && accesos.isPending && <p className="m-0 text-[13px] font-semibold text-neutral-700">Revisando accesos temporales…</p>}
      {otorga && profesionalId && vigente && <Aviso tono="exito">Tiene acceso clínico temporal vigente para esta sesión.</Aviso>}
      {otorgar && (
        <Field
          label="Acceso de reemplazo hasta"
          hint="Lectura y escritura de la ficha, para atender y registrar la evolución. Máximo 180 días; queda en la auditoría."
          required
        >
          {(p) => <Input {...p} type="date" min={diaSesion} max={sumarDias(diaSesion, 179)} value={hasta} onChange={(e) => setHasta(e.target.value)} />}
        </Field>
      )}
      {!otorga && (
        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Gestión no otorga accesos clínicos: si falta, pídelo a administración o al tratante.</p>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="team"
          icon="swap_horiz"
          disabled={!profesionalId || (otorga && accesos.isPending)}
          loading={cubrir.isPending}
          onClick={() => cubrir.mutate()}
          className="!py-2.5"
        >
          {otorgar ? 'Otorgar acceso y cubrir' : 'Cubrir sesión'}
        </Button>
      </div>
    </div>
  );
}
