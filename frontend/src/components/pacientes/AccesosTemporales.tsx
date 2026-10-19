'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { Pestanas } from '@/components/ui/Pestanas';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta, useProfesionales } from '@/lib/consultas';
import { ALCANCE_ACCESO, accesoVigente, MOTIVO_ACCESO, useAccesosRecibidos, type AccesoTemporal } from '@/lib/derivaciones';
import { formatoFecha } from '@/lib/formato';
import { fechaHoyChile, inicioDiaChile, nombresPacientes, sumarDias, useAccesosTemporales, usePacientes } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

const MAX_DIAS = 180;

/**
 * Accesos clinicos temporales de un paciente (C-4, C-5): REEMPLAZO o
 * INTERCONSULTA a otro profesional, de solo lectura o con escritura, hasta una
 * fecha (maximo 180 dias). Lo otorgan ADMIN o el tratante; el paciente recibe
 * un aviso; se corta solo al vencer y queda en la auditoria. No cambia el
 * tratante: para eso esta la derivacion.
 */
export function AccesosPaciente({ pacienteId, tratanteId, puedeOtorgar }: { pacienteId: string; tratanteId: string | null; puedeOtorgar: boolean }) {
  const accesos = useAccesosTemporales(pacienteId, true);
  const profesionales = useProfesionales(true);
  const nombre = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const [otorgar, setOtorgar] = useState(false);
  const [vista, setVista] = useState<'vigentes' | 'vencidos'>('vigentes');
  return (
    <Panel
      titulo="Accesos clínicos temporales"
      bajada="Otro profesional ve (o también escribe) la ficha por un tiempo, sin cambiar el tratante. El paciente recibe un aviso."
      accion={
        puedeOtorgar && (
          <Button variant="secondary" icon="key" onClick={() => setOtorgar(true)} className="!py-2.5">
            Otorgar acceso
          </Button>
        )
      }
    >
      <div className="mt-4 flex flex-col gap-3">
        <EstadoConsulta consulta={accesos}>
          {(lista) => {
            const vigentes = lista.filter((a) => accesoVigente(a));
            const otros = lista.filter((a) => !accesoVigente(a));
            const visibles = vista === 'vigentes' ? vigentes : otros;
            return (
              <>
                <Pestanas
                  etiqueta="Accesos"
                  tono="team"
                  valor={vista}
                  onChange={setVista}
                  pestanas={[
                    { valor: 'vigentes', etiqueta: `Vigentes (${vigentes.length})` },
                    { valor: 'vencidos', etiqueta: `Vencidos o por empezar (${otros.length})` },
                  ]}
                />
                {visibles.length === 0 ? (
                  <p className="m-0 text-[13.5px] font-semibold text-neutral-700">
                    {vista === 'vigentes' ? 'Ningún acceso vigente.' : 'Sin accesos anteriores.'}
                  </p>
                ) : (
                  <ul className="m-0 flex list-none flex-col p-0">
                    {visibles.map((a) => (
                      <FilaAcceso key={a.id} acceso={a} profesional={nombre.get(a.profesionalId)} otorgante={nombre.get(a.otorgadoPorId)} />
                    ))}
                  </ul>
                )}
              </>
            );
          }}
        </EstadoConsulta>
      </div>
      <Modal abierto={otorgar} onCerrar={() => setOtorgar(false)} titulo="Otorgar acceso clínico temporal">
        {otorgar && <OtorgarAcceso pacienteId={pacienteId} excluir={tratanteId} onListo={() => setOtorgar(false)} />}
      </Modal>
    </Panel>
  );
}

function FilaAcceso({ acceso: a, profesional, otorgante, paciente }: { acceso: AccesoTemporal; profesional?: string; otorgante?: string; paciente?: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-divider py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="m-0 text-[14.5px] font-extrabold">{paciente ?? profesional ?? 'Profesional del centro'}</p>
        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
          {paciente ? `${profesional ?? 'Profesional'} · ` : ''}
          {formatoFecha(a.desde)} al {formatoFecha(a.hasta)}
          {otorgante ? ` · otorgó ${otorgante}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tono="neutro">{MOTIVO_ACCESO[a.motivo]}</Badge>
        <Badge tono={a.alcance === 'LECTURA_ESCRITURA' ? 'atencion' : 'neutro'}>{ALCANCE_ACCESO[a.alcance]}</Badge>
      </div>
    </li>
  );
}

function OtorgarAcceso({ pacienteId, excluir, onListo }: { pacienteId: string; excluir: string | null; onListo: () => void }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const profesionales = useProfesionales(true);
  const hoy = fechaHoyChile();
  const [d, setD] = useState({
    profesionalId: '',
    motivo: 'INTERCONSULTA' as AccesoTemporal['motivo'],
    alcance: 'LECTURA' as AccesoTemporal['alcance'],
    hasta: sumarDias(hoy, 30),
  });
  const [error, setError] = useState<string>();
  const otorgar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/pacientes/{id}/accesos-temporales', {
          params: { path: { id: pacienteId } },
          // Hasta el fin del dia elegido (hora de Chile).
          body: { profesionalId: d.profesionalId, motivo: d.motivo, alcance: d.alcance, hasta: inicioDiaChile(sumarDias(d.hasta, 1)).toISOString() },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'accesos-temporales'] });
      onListo();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos otorgar el acceso.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!d.profesionalId) return setError('Elige al profesional.');
    setError(undefined);
    otorgar.mutate();
  };
  const candidatos = (profesionales.data ?? []).filter((p) => p.id !== excluir && p.id !== cuenta.data?.id);
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <Field label="Profesional" required>
        {(p) => (
          <Select {...p} value={d.profesionalId} onChange={(e) => setD({ ...d, profesionalId: e.target.value })}>
            <option value="">Elige un profesional</option>
            {candidatos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre ?? 'Profesional'}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ChoiceGroup
        legend="Motivo"
        type="radio"
        value={[d.motivo]}
        onChange={(v) => setD({ ...d, motivo: (v[0] as AccesoTemporal['motivo']) ?? 'INTERCONSULTA' })}
        options={[
          { value: 'INTERCONSULTA', label: 'Interconsulta (opinión de otro profesional)' },
          { value: 'REEMPLAZO', label: 'Reemplazo (cubre sesiones del tratante)' },
        ]}
      />
      <ChoiceGroup
        legend="Alcance"
        type="radio"
        value={[d.alcance]}
        onChange={(v) => setD({ ...d, alcance: (v[0] as AccesoTemporal['alcance']) ?? 'LECTURA' })}
        options={[
          { value: 'LECTURA', label: 'Solo lectura de la ficha' },
          { value: 'LECTURA_ESCRITURA', label: 'Lectura y escritura (puede registrar evoluciones)' },
        ]}
      />
      <Field label="Hasta" required hint={`Máximo ${MAX_DIAS} días. Se corta solo al vencer.`}>
        {(p) => (
          <Input {...p} type="date" min={hoy} max={sumarDias(hoy, MAX_DIAS - 1)} value={d.hasta} onChange={(e) => setD({ ...d, hasta: e.target.value })} />
        )}
      </Field>
      <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
        El paciente recibe un aviso del acceso. Queda registrado en la auditoría de la ficha y no se puede revocar antes del plazo.
      </p>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button type="submit" variant="team" icon="key" loading={otorgar.isPending}>
          Otorgar acceso
        </Button>
      </div>
    </form>
  );
}

/**
 * Fichas › Accesos temporales: ADMIN ve todos; el profesional, los que
 * recibio y los otorgados sobre sus pacientes. Vigentes y vencidos.
 */
export function AccesosTemporalesVista({ rol }: { rol: Rol }) {
  const accesos = useAccesosRecibidos(true);
  const cuenta = useMiCuenta();
  const pacientes = usePacientes();
  const profesionales = useProfesionales(true);
  const nombrePaciente = nombresPacientes(pacientes.data);
  const nombre = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const [vista, setVista] = useState<'vigentes' | 'vencidos'>('vigentes');
  return (
    <div className="flex flex-col gap-4">
      <Pestanas
        etiqueta="Accesos"
        tono="team"
        valor={vista}
        onChange={setVista}
        pestanas={[
          { valor: 'vigentes', etiqueta: 'Vigentes' },
          { valor: 'vencidos', etiqueta: 'Vencidos o por empezar' },
        ]}
      />
      <EstadoConsulta
        consulta={accesos}
        vacio={(l) => !l.some((a) => accesoVigente(a) === (vista === 'vigentes'))}
        textoVacio={vista === 'vigentes' ? 'Ningún acceso vigente' : 'Sin accesos anteriores'}
      >
        {(lista) => (
          <Tabla etiqueta="Accesos clínicos temporales">
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Profesional con acceso</Th>
                <Th>Motivo y alcance</Th>
                <Th>Periodo</Th>
                <Th>
                  <span className="sr-only">Acción</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {lista
                .filter((a) => accesoVigente(a) === (vista === 'vigentes'))
                .map((a) => {
                  const recibido = a.profesionalId === cuenta.data?.id;
                  return (
                    <tr key={a.id}>
                      <Td className="font-extrabold">{nombrePaciente.get(a.pacienteId) ?? 'Paciente'}</Td>
                      <Td>{recibido ? 'Tú' : (nombre.get(a.profesionalId) ?? 'Profesional')}</Td>
                      <Td>
                        {MOTIVO_ACCESO[a.motivo]} · {ALCANCE_ACCESO[a.alcance].toLowerCase()}
                      </Td>
                      <Td>
                        {formatoFecha(a.desde)} al {formatoFecha(a.hasta)}
                      </Td>
                      <Td className="text-right">
                        {rol === 'PROFESIONAL' && recibido && accesoVigente(a) && (
                          <ButtonLink href={`/admin/fichas/${a.pacienteId}/ficha`} variant="secondary" className="!px-4 !py-2 !text-[13px]">
                            Abrir ficha
                          </ButtonLink>
                        )}
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </Tabla>
        )}
      </EstadoConsulta>
    </div>
  );
}
