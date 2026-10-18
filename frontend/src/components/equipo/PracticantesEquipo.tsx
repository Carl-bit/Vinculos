'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
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

  return (
    <div className="flex flex-col gap-4">
      <EstadoConsulta consulta={practicantes} vacio={(l) => l.length === 0} textoVacio="No hay practicantes">
        {(l) => (
          <Tabla etiqueta="Practicantes">
            <thead>
              <tr>
                <Th>Practicante</Th>
                <Th>Supervisor</Th>
                <Th>Práctica</Th>
                <Th>Acceso</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {l.map((p) => {
                const cuenta = nombreCuenta.get(p.usuarioId);
                const sup = (supervisiones.data ?? []).find((s) => s.practicanteId === p.usuarioId && !s.hasta);
                const expira = cuenta?.fechaExpiracionAcceso;
                const vigente = cuenta?.activo && expira && new Date(expira).getTime() > Date.now();
                return (
                  <tr key={p.usuarioId}>
                    <Td className="font-extrabold">{cuenta?.nombre ?? nombreDirectorio.get(p.usuarioId) ?? 'Practicante'}</Td>
                    <Td className="font-semibold">
                      {sup ? (nombrePro.get(sup.supervisorId) ?? 'Profesional') : <span className="text-accent-700">Sin supervisor</span>}
                    </Td>
                    <Td className="font-semibold text-neutral-800">
                      {formatoFecha(String(p.fechaInicio).slice(0, 10))} al {formatoFecha(String(p.fechaTerminoPractica).slice(0, 10))}
                    </Td>
                    <Td>{admin ? <Badge tono={vigente ? 'positivo' : 'neutro'}>{vigente ? `Hasta ${formatoFecha(expira)}` : 'Sin acceso'}</Badge> : '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="ghost" onClick={() => setAccion({ tipo: 'historial', id: p.usuarioId })} className="!px-3 !py-1.5 !text-[12.5px]">
                          Historial
                        </Button>
                        {admin && (
                          <>
                            <Button variant="ghost" onClick={() => setAccion({ tipo: 'extender', id: p.usuarioId })} className="!px-3 !py-1.5 !text-[12.5px]">
                              {vigente ? 'Extender' : 'Dar acceso'}
                            </Button>
                            <Button variant="ghost" onClick={() => setAccion({ tipo: 'supervisor', id: p.usuarioId })} className="!px-3 !py-1.5 !text-[12.5px]">
                              Supervisor
                            </Button>
                            {vigente && (
                              <Button variant="ghost" onClick={() => setAccion({ tipo: 'revocar', id: p.usuarioId })} className="!px-3 !py-1.5 !text-[12.5px]">
                                Revocar
                              </Button>
                            )}
                          </>
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

function AccionPracticante({
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
