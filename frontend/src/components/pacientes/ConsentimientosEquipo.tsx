'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useMiCuenta } from '@/lib/consultas';
import {
  ESTADO_CONSENTIMIENTO,
  useAvisosConsentimientoEquipo,
  useConsentimientosEquipo,
  usePoliticaPracticante,
  type AvisoConsentimientoEquipo,
  type ConsentimientoEquipo,
} from '@/lib/derivaciones';
import { useSupervisiones } from '@/lib/equipo';
import { formatoFechaHora } from '@/lib/formato';
import { nombresPacientes, useAdultosResponsables, useEquipoAgenda, usePacientes } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

type Registro =
  | { tipo: 'respuesta'; c: ConsentimientoEquipo }
  | { tipo: 'revocar'; c: ConsentimientoEquipo }
  | { tipo: 'aviso'; a: AvisoConsentimientoEquipo; c: ConsentimientoEquipo };

const textoError = (e: unknown, base: string) => (e instanceof ApiError ? e.message : base);

/**
 * Consentimientos de atencion con practicante supervisado (02f, D-3), vista
 * del equipo. Responde el paciente (o su adulto responsable) en su cuenta o
 * por el enlace del correo; administracion lo envia o registra la respuesta
 * firmada en el centro, siempre con respaldo. ADMIN o el supervisor vigente
 * piden un consentimiento nuevo. Tambien los avisos de cambio de supervisor.
 */
export function ConsentimientosEquipo({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const consentimientos = useConsentimientosEquipo(true);
  const avisos = useAvisosConsentimientoEquipo(true);
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombre = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Integrante']));
  const nombrePaciente = nombresPacientes(pacientes.data);
  const [registro, setRegistro] = useState<Registro | null>(null);
  const [solicitar, setSolicitar] = useState(false);
  const [aviso, setAviso] = useState<string>();
  const cliente = useQueryClient();
  const enlace = useMutation({
    mutationFn: (x: { tipo: 'consentimiento' | 'aviso'; id: string }) =>
      x.tipo === 'consentimiento'
        ? datos(api.POST('/api/consentimientos/{id}/enlace', { params: { path: { id: x.id } } }))
        : datos(api.POST('/api/avisos-consentimiento/{id}/enlace', { params: { path: { id: x.id } } })),
    onSuccess: (r) => setAviso(`Enviamos el enlace por correo. Vence el ${formatoFechaHora(r.venceEn)}.`),
  });
  const ahora = Date.now();
  const listo = () => {
    setRegistro(null);
    void cliente.invalidateQueries({ queryKey: ['panel'] });
  };
  return (
    <div className="flex flex-col gap-4">
      {aviso && (
        <Aviso tono="exito" role="status">
          {aviso}
        </Aviso>
      )}
      {enlace.error && (
        <Aviso tono="advertencia" role="alert">
          {textoError(enlace.error, 'No pudimos enviar el enlace.')}
        </Aviso>
      )}
      <Panel
        titulo="Atención con practicante supervisado"
        bajada="El practicante solo atiende con el consentimiento vigente del paciente (o de su adulto responsable). Retirarlo deja las horas por reprogramar."
        accion={
          (rol === 'ADMIN' || rol === 'PROFESIONAL') && (
            <Button variant="secondary" icon="verified_user" onClick={() => setSolicitar(true)} className="!py-2.5">
              Pedir consentimiento
            </Button>
          )
        }
      >
        <div className="mt-4">
          <EstadoConsulta consulta={consentimientos} vacio={(l) => l.length === 0} textoVacio="No hay consentimientos de practicante">
            {(lista) => (
              <ul className="m-0 flex list-none flex-col p-0">
                {lista.map((c) => {
                  const e = ESTADO_CONSENTIMIENTO[c.estado];
                  const abierto = c.estado === 'SOLICITADO' && new Date(c.venceEn).getTime() > ahora;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                      <div className="min-w-0 flex-[1_1_260px]">
                        <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
                          {nombrePaciente.get(c.pacienteId) ?? 'Paciente'}
                          <Badge tono={e.tono}>{e.texto}</Badge>
                        </p>
                        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                          Atiende {nombre.get(c.practicanteId) ?? 'un practicante'} · supervisa {nombre.get(c.supervisorId) ?? 'un profesional'}
                          {abierto ? ` · responde hasta el ${formatoFechaHora(c.venceEn)}` : ''}
                          {c.estado === 'ACEPTADO' && c.versionDocumento ? ` · versión ${c.versionDocumento}` : ''}
                        </p>
                      </div>
                      {admin && (
                        <div className="flex flex-wrap gap-2">
                          {abierto && (
                            <>
                              <Button
                                variant="ghost"
                                icon="mail"
                                loading={enlace.isPending && enlace.variables?.id === c.id}
                                onClick={() => enlace.mutate({ tipo: 'consentimiento', id: c.id })}
                                className="!px-3.5 !py-2 !text-[13px]"
                              >
                                Enviar enlace
                              </Button>
                              <Button variant="secondary" onClick={() => setRegistro({ tipo: 'respuesta', c })} className="!px-4 !py-2 !text-[13px]">
                                Registrar firmado
                              </Button>
                            </>
                          )}
                          {c.estado === 'ACEPTADO' && (
                            <Button variant="ghost" onClick={() => setRegistro({ tipo: 'revocar', c })} className="!px-3.5 !py-2 !text-[13px]">
                              Registrar retiro
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>

      <Panel titulo="Avisos de cambio de supervisor" bajada="El paciente puede oponerse dentro del plazo; oponerse equivale a retirar el consentimiento.">
        <div className="mt-4">
          <EstadoConsulta consulta={avisos} vacio={(l) => l.length === 0} textoVacio="Sin avisos de cambio de supervisor">
            {(lista) => (
              <ul className="m-0 flex list-none flex-col p-0">
                {lista.map((a) => {
                  const c = consentimientos.data?.find((x) => x.id === a.consentimientoId);
                  const abierto = a.respuesta === 'SIN_RESPUESTA' && new Date(a.venceEn).getTime() > ahora;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                      <div className="min-w-0 flex-[1_1_260px]">
                        <p className="m-0 text-[14.5px] font-extrabold">{c ? (nombrePaciente.get(c.pacienteId) ?? 'Paciente') : 'Paciente'}</p>
                        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                          De {nombre.get(a.supervisorAnteriorId) ?? 'un profesional'} a {nombre.get(a.supervisorNuevoId) ?? 'un profesional'} ·{' '}
                          {a.respuesta === 'CONFORME'
                            ? 'conforme'
                            : a.respuesta === 'OPOSICION'
                              ? 'se opuso'
                              : abierto
                                ? `plazo hasta el ${formatoFechaHora(a.venceEn)}`
                                : 'sin respuesta (conforme por plazo)'}
                        </p>
                      </div>
                      {admin && abierto && c && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            icon="mail"
                            loading={enlace.isPending && enlace.variables?.id === a.id}
                            onClick={() => enlace.mutate({ tipo: 'aviso', id: a.id })}
                            className="!px-3.5 !py-2 !text-[13px]"
                          >
                            Enviar enlace
                          </Button>
                          <Button variant="secondary" onClick={() => setRegistro({ tipo: 'aviso', a, c })} className="!px-4 !py-2 !text-[13px]">
                            Registrar respuesta
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>

      <Modal
        abierto={!!registro}
        onCerrar={() => setRegistro(null)}
        titulo={
          registro?.tipo === 'revocar'
            ? 'Registrar retiro del consentimiento'
            : registro?.tipo === 'aviso'
              ? 'Registrar respuesta al aviso'
              : 'Registrar consentimiento firmado'
        }
      >
        {registro && <RegistroPresencial registro={registro} paciente={nombrePaciente.get(registro.c.pacienteId)} onListo={listo} />}
      </Modal>
      <Modal abierto={solicitar} onCerrar={() => setSolicitar(false)} titulo="Pedir consentimiento">
        {solicitar && <SolicitarConsentimiento rol={rol} onListo={() => setSolicitar(false)} />}
      </Modal>
    </div>
  );
}

/** Respuesta firmada en el centro: quien otorga (paciente o su adulto responsable) y el respaldo (lo exige la BD). */
function RegistroPresencial({ registro, paciente, onListo }: { registro: Registro; paciente?: string; onListo: () => void }) {
  const pacienteId = registro.c.pacienteId;
  const datosPaciente = usePacientes();
  const adultos = useAdultosResponsables(pacienteId);
  const politica = usePoliticaPracticante();
  const menor = (() => {
    const p = datosPaciente.data?.find((x) => x.id === pacienteId);
    return p ? edadEn(p.fechaNacimiento) < 18 : false;
  })();
  const [decision, setDecision] = useState<'si' | 'no'>('si');
  const [adultoId, setAdultoId] = useState('');
  const [respaldo, setRespaldo] = useState('');
  const otorgante = menor ? { otorgadoPorTipo: 'ADULTO_RESPONSABLE' as const, adultoResponsableId: adultoId } : { otorgadoPorTipo: 'PACIENTE' as const };
  const guardar = useMutation({
    mutationFn: (): Promise<unknown> => {
      const base = { ...otorgante, respaldoDocumentoRef: respaldo.trim() };
      if (registro.tipo === 'revocar') return datos(api.POST('/api/consentimientos/{id}/revocacion', { params: { path: { id: registro.c.id } }, body: base }));
      if (registro.tipo === 'aviso')
        return datos(
          api.POST('/api/avisos-consentimiento/{id}/respuesta', {
            params: { path: { id: registro.a.id } },
            body: { ...base, respuesta: decision === 'si' ? 'CONFORME' : 'OPOSICION' },
          }),
        );
      return datos(
        api.POST('/api/consentimientos/{id}/respuesta', {
          params: { path: { id: registro.c.id } },
          body: { ...base, acepta: decision === 'si', versionDocumento: decision === 'si' ? String(politica.data?.version ?? '') : undefined },
        }),
      );
    },
    onSuccess: onListo,
  });
  const listo = respaldo.trim().length >= 1 && (!menor || !!adultoId) && (registro.tipo !== 'respuesta' || decision === 'no' || !!politica.data);
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        {paciente ?? 'Paciente'}
        {menor ? ' (menor de edad: lo firma su adulto responsable)' : ''}. Úsalo solo con el documento firmado en el centro.
      </p>
      {registro.tipo === 'respuesta' && (
        <>
          <ChoiceGroup
            legend="Respuesta"
            type="radio"
            value={[decision]}
            onChange={(v) => setDecision((v[0] as 'si' | 'no') ?? 'si')}
            options={[
              { value: 'si', label: politica.data ? `Acepta (documento versión ${politica.data.version})` : 'Acepta' },
              { value: 'no', label: 'No acepta (el practicante no lo atiende)' },
            ]}
          />
        </>
      )}
      {registro.tipo === 'aviso' && (
        <ChoiceGroup
          legend="Respuesta al cambio de supervisor"
          type="radio"
          value={[decision]}
          onChange={(v) => setDecision((v[0] as 'si' | 'no') ?? 'si')}
          options={[
            { value: 'si', label: 'Conforme' },
            { value: 'no', label: 'Se opone (equivale a retirar el consentimiento)' },
          ]}
        />
      )}
      {registro.tipo === 'revocar' && (
        <p className="m-0 text-[13px] font-bold text-accent-800">Efecto inmediato: las horas futuras con el practicante quedan por reprogramar.</p>
      )}
      {menor && (
        <Field label="Firmado por" required>
          {(p) => (
            <Select {...p} value={adultoId} onChange={(e) => setAdultoId(e.target.value)}>
              <option value="">Elige al adulto responsable</option>
              {(adultos.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {a.parentesco ? ` (${a.parentesco})` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="Respaldo del documento" required hint="Ej.: escaneado en Consentimientos/2026, folio 18.">
        {(p) => <Input {...p} maxLength={500} value={respaldo} onChange={(e) => setRespaldo(e.target.value)} />}
      </Field>
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(guardar.error, 'No pudimos registrar la respuesta.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" disabled={!listo} loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Registrar
        </Button>
      </div>
    </div>
  );
}

/** ADMIN o el supervisor vigente piden un consentimiento nuevo para un paciente que atiende un practicante. */
function SolicitarConsentimiento({ rol, onListo }: { rol: Rol; onListo: () => void }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const supervisiones = useSupervisiones();
  const pacientes = usePacientes();
  const practicantes = new Set(
    (supervisiones.data ?? []).filter((s) => !s.hasta && (rol === 'ADMIN' || s.supervisorId === cuenta.data?.id)).map((s) => s.practicanteId),
  );
  const opciones = (pacientes.data ?? []).filter((p) => p.profesionalId && practicantes.has(p.profesionalId));
  const [pacienteId, setPacienteId] = useState('');
  const pedir = useMutation({
    mutationFn: () => datos(api.POST('/api/consentimientos/solicitudes', { body: { pacienteId } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'consentimientos'] });
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        Por ejemplo, tras un cambio de supervisor o si el consentimiento venció. Se avisa al paciente y responde en su cuenta o por el enlace del correo.
      </p>
      <Field label="Paciente" required>
        {(p) => (
          <Select {...p} value={pacienteId} onChange={(e) => setPacienteId(e.target.value)}>
            <option value="">{opciones.length ? 'Elige un paciente' : 'Ningún paciente atendido por un practicante que supervises'}</option>
            {opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.apellido}, {o.nombre}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {pedir.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(pedir.error, 'No pudimos pedir el consentimiento.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" disabled={!pacienteId} loading={pedir.isPending} onClick={() => pedir.mutate()}>
          Pedir consentimiento
        </Button>
      </div>
    </div>
  );
}
