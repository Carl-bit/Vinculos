'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useProfesionales } from '@/lib/consultas';
import { useCuentasEquipo, usePracticantes, useSupervisiones } from '@/lib/equipo';
import { formatoFecha } from '@/lib/formato';
import { useEquipoAgenda } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

const ACCION = { OTORGADO: 'Acceso otorgado', REVOCADO: 'Acceso revocado', EXPIRADO: 'Acceso vencido' } as const;
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

/**
 * Practicantes (RF-27): acceso siempre con fecha de termino, bajo un
 * supervisor. Extender o revocar queda en la bitacora; revocar deshabilita y
 * nunca borra lo que atendio. Cambiar de supervisor avisa a los pacientes con
 * consentimiento vigente (plazo de oposicion). Escribe solo ADMIN.
 */
export function PracticantesEquipo({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  const practicantes = usePracticantes();
  const supervisiones = useSupervisiones();
  const cuentas = useCuentasEquipo(admin);
  const profesionales = useProfesionales(true);
  const directorio = useEquipoAgenda();
  const nombreDirectorio = new Map((directorio.data ?? []).map((m) => [m.id, m.nombre ?? 'Practicante']));
  const nombreCuenta = new Map((cuentas.data ?? []).map((c) => [c.id, c]));
  const nombrePro = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const [accion, setAccion] = useState<{ tipo: 'extender' | 'supervisor' | 'revocar' | 'historial'; id: string } | null>(null);

  const filas = (practicantes.data ?? []).map((p) => {
    const cuenta = nombreCuenta.get(p.usuarioId);
    const sup = (supervisiones.data ?? []).find((s) => s.practicanteId === p.usuarioId && !s.hasta);
    const expira = cuenta?.fechaExpiracionAcceso;
    const vigente = !!(cuenta?.activo && expira && new Date(expira).getTime() > Date.now());
    return { p, nombre: cuenta?.nombre ?? nombreDirectorio.get(p.usuarioId) ?? 'Practicante', sup, expira, vigente };
  });
  const resumen = [
    { n: filas.length, l: filas.length === 1 ? 'practicante' : 'practicantes', c: 'bg-neutral-200 text-neutral-800' },
    ...(admin
      ? [
          { n: filas.filter((f) => f.vigente && f.sup).length, l: 'habilitados', c: 'bg-accent-2-200 text-accent-2-900' },
          { n: filas.filter((f) => !f.vigente).length, l: 'sin acceso', c: 'bg-accent-200 text-accent-900' },
        ]
      : []),
    { n: filas.filter((f) => !f.sup).length, l: 'sin supervisor', c: 'bg-pendiente-100 text-pendiente-900' },
  ];
  const boton = '!min-h-10 !px-3.5 !py-2 !text-[13px]';

  return (
    <div className="flex flex-col gap-4">
      <EstadoConsulta consulta={practicantes} vacio={(l) => l.length === 0} textoVacio="No hay practicantes">
        {() => (
          <>
            <ul aria-label="Resumen de practicantes" className="m-0 flex list-none flex-wrap gap-2.5 p-0">
              {resumen.map((r) => (
                <li key={r.l} className={`inline-flex items-baseline gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold ${r.c}`}>
                  <strong className="text-[18px] font-black">{r.n}</strong>
                  {r.l}
                </li>
              ))}
            </ul>
            {filas.map(({ p, nombre, sup, expira, vigente }) => {
              const habilitado = vigente && !!sup;
              const datosTarjeta: { l: string; v: string; s: string; tono?: 'alerta' | 'ok' }[] = [
                {
                  l: 'Supervisor',
                  v: sup ? (nombrePro.get(sup.supervisorId) ?? 'Profesional') : 'Sin supervisor',
                  s: sup ? `Desde ${formatoFecha(sup.desde)}` : 'No puede atender',
                  tono: sup ? undefined : 'alerta',
                },
                {
                  l: 'Práctica',
                  v: `${formatoFecha(String(p.fechaInicio).slice(0, 10))} al ${formatoFecha(String(p.fechaTerminoPractica).slice(0, 10))}`,
                  s: 'Según el convenio con la universidad',
                },
              ];
              if (admin)
                datosTarjeta.push({
                  l: 'Acceso',
                  v: vigente ? `Hasta ${formatoFecha(expira!)}` : 'Sin acceso',
                  s: vigente ? 'Se cierra solo en esa fecha' : expira ? `Venció el ${formatoFecha(expira)}` : 'Nunca se otorgó',
                  tono: vigente ? 'ok' : 'alerta',
                });
              return (
                <section key={p.usuarioId} aria-label={nombre} className="flex flex-col gap-3.5 rounded-lg border border-divider bg-bg p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3.5">
                    <Avatar name={nombre} size={52} tone="patient" />
                    <div className="flex min-w-0 flex-[1_1_240px] flex-col">
                      <strong className="text-[19px] font-black tracking-[-0.02em]">{nombre}</strong>
                      <span className="text-[13px] font-semibold text-neutral-800">Práctica profesional supervisada</span>
                    </div>
                    {admin && (
                      <span
                        className={`inline-flex items-center gap-2 rounded-[14px] px-3.5 py-2 text-[13.5px] font-extrabold ${
                          habilitado ? 'bg-accent-2-200 text-accent-2-900' : 'bg-accent-200 text-accent-900'
                        }`}
                      >
                        <span aria-hidden className="size-2.5 rounded-full bg-current" />
                        {habilitado ? 'Habilitado para atender' : vigente ? 'Sin supervisor asignado' : 'Sin acceso'}
                      </span>
                    )}
                  </div>
                  <dl className="m-0 grid gap-2.5 sm:grid-cols-3">
                    {datosTarjeta.map((d) => (
                      <div key={d.l} className="flex flex-col gap-0.5 rounded-[16px] bg-neutral-100 p-3">
                        <dt className="text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">{d.l}</dt>
                        <dd
                          className={`m-0 text-[14px] font-extrabold ${d.tono === 'alerta' ? 'text-accent-800' : d.tono === 'ok' ? 'text-accent-2-800' : ''}`}
                        >
                          {d.v}
                        </dd>
                        <dd className="m-0 text-[11.5px] font-semibold text-neutral-700">{d.s}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex flex-wrap gap-1.5">
                    {admin && !vigente && (
                      <Button variant="team" onClick={() => setAccion({ tipo: 'extender', id: p.usuarioId })} className={boton}>
                        Dar acceso
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setAccion({ tipo: 'historial', id: p.usuarioId })} className={boton}>
                      Historial
                    </Button>
                    {admin && vigente && (
                      <Button variant="secondary" onClick={() => setAccion({ tipo: 'extender', id: p.usuarioId })} className={boton}>
                        Extender acceso
                      </Button>
                    )}
                    {admin && (
                      <Button variant="secondary" onClick={() => setAccion({ tipo: 'supervisor', id: p.usuarioId })} className={boton}>
                        Cambiar supervisor
                      </Button>
                    )}
                    {admin && vigente && (
                      <Button variant="ghost" onClick={() => setAccion({ tipo: 'revocar', id: p.usuarioId })} className={`${boton} !text-accent-800`}>
                        Revocar acceso
                      </Button>
                    )}
                  </div>
                </section>
              );
            })}
            <p className="m-0 px-1.5 text-[12px] font-semibold text-neutral-700">
              Un practicante solo atiende con acceso vigente, supervisor asignado y el consentimiento de cada paciente. Cambiar el supervisor no mueve sus
              sesiones: avisa a sus pacientes, que pueden oponerse dentro del plazo del centro.
            </p>
          </>
        )}
      </EstadoConsulta>
      {accion && (
        <AccionPracticante
          key={`${accion.tipo}-${accion.id}`}
          {...accion}
          nombre={nombreCuenta.get(accion.id)?.nombre ?? 'Practicante'}
          onCerrar={() => setAccion(null)}
        />
      )}
    </div>
  );
}

export function AccionPracticante({
  tipo,
  id,
  nombre,
  onCerrar,
}: {
  tipo: 'extender' | 'supervisor' | 'revocar' | 'historial';
  id: string;
  nombre: string;
  onCerrar: () => void;
}) {
  const cliente = useQueryClient();
  const profesionales = useProfesionales(true);
  const historial = useQuery({
    queryKey: ['equipo', 'practicantes', id, 'historial'],
    queryFn: () => datos(api.GET('/api/practicantes/{id}/historial', { params: { path: { id } } })),
    enabled: tipo === 'historial',
  });
  const [fecha, setFecha] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const [resultado, setResultado] = useState<string>();
  const enviar = useMutation({
    mutationFn: async (): Promise<string> => {
      if (tipo === 'extender') {
        const r = await datos(
          api.POST('/api/practicantes/{id}/acceso', { params: { path: { id } }, body: { fechaExpiracion: fecha, supervisorId: supervisorId || undefined } }),
        );
        return r.avisosCambioSupervisor
          ? `Acceso actualizado. Se avisó a ${r.avisosCambioSupervisor} pacientes del cambio de supervisor.`
          : 'Acceso actualizado.';
      }
      if (tipo === 'supervisor') {
        const r = await datos(api.POST('/api/practicantes/{id}/supervisor', { params: { path: { id } }, body: { supervisorId } }));
        return `Supervisor cambiado. Pacientes avisados: ${r.avisosCreados}.`;
      }
      await datos(api.POST('/api/practicantes/{id}/revocacion', { params: { path: { id } }, body: { motivo: motivo.trim() } }));
      return 'Acceso revocado. Su historial de atenciones se conserva.';
    },
    onSuccess: (texto) => {
      setResultado(texto);
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos completar la acción.'),
  });
  const valido = tipo === 'extender' ? !!fecha : tipo === 'supervisor' ? !!supervisorId : motivo.trim().length >= 3;
  const titulo = {
    extender: `Acceso de ${nombre}`,
    supervisor: `Supervisor de ${nombre}`,
    revocar: `Revocar acceso de ${nombre}`,
    historial: `Historial de ${nombre}`,
  }[tipo];
  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo}>
      {tipo === 'historial' ? (
        <EstadoConsulta consulta={historial} vacio={(l) => l.length === 0} textoVacio="Sin movimientos">
          {(l) => (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {l.map((h) => (
                <li key={h.id} className="rounded-[14px] border border-divider bg-bg px-3.5 py-2.5 text-[13.5px]">
                  <span className="font-extrabold">{ACCION[h.accion]}</span> · {formatoFecha(h.createdAt)}
                  {h.fechaExpiracion && ` · hasta ${formatoFecha(h.fechaExpiracion)}`}
                  {h.motivo && <span className="block text-[12.5px] font-semibold text-neutral-800">{h.motivo}</span>}
                </li>
              ))}
            </ol>
          )}
        </EstadoConsulta>
      ) : resultado ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="m-0 text-[14px] font-bold text-accent-2-800">
            {resultado}
          </p>
          <div className="flex justify-end">
            <Button variant="team" onClick={onCerrar}>
              Listo
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tipo === 'extender' && (
            <Field label="Acceso hasta" required hint="El acceso se cierra solo en esa fecha.">
              {(x) => <Input {...x} type="date" min={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} />}
            </Field>
          )}
          {(tipo === 'extender' || tipo === 'supervisor') && (
            <Field label={tipo === 'extender' ? 'Nuevo supervisor (solo si su supervisión terminó)' : 'Nuevo supervisor'} required={tipo === 'supervisor'}>
              {(x) => (
                <Select {...x} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
                  <option value="">{tipo === 'extender' ? 'Mantener el actual' : 'Elige un profesional'}</option>
                  {profesionales.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre ?? 'Profesional'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {tipo === 'supervisor' && (
            <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
              Los pacientes con consentimiento vigente reciben un aviso y pueden oponerse dentro del plazo del centro.
            </p>
          )}
          {tipo === 'revocar' && (
            <Field label="Motivo" required hint="Queda en la bitácora. Lo que atendió no se borra.">
              {(x) => <Input {...x} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />}
            </Field>
          )}
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2.5">
            <Button variant="ghost" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button variant="team" disabled={!valido} loading={enviar.isPending} onClick={() => enviar.mutate()}>
              {tipo === 'revocar' ? 'Revocar acceso' : 'Guardar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
