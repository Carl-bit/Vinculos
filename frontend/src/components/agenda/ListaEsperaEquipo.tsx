'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFecha } from '@/lib/formato';
import { nombresPacientes, useEquipoAgenda, usePacientes } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

/**
 * Lista de espera interna (pacientes del centro, 03a): por profesional. Al
 * liberarse una hora apartada la BD avisa a la lista; el equipo agenda y
 * marca la entrada como asignada. La lista publica sin cuenta (03b) avisa
 * sola por correo y no se gestiona aca.
 */
export function ListaEsperaEquipo({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const cliente = useQueryClient();
  const { profesionalId } = useEquipoActivo();
  const cuenta = useMiCuenta();
  const filtro = admin ? (profesionalId ?? undefined) : cuenta.data?.id;
  const lista = useQuery({
    queryKey: ['panel', 'lista-espera', filtro ?? 'todos'],
    queryFn: () => datos(api.GET('/api/lista-espera', { params: { query: { estado: 'ACTIVA', profesionalId: filtro } } })),
    enabled: admin || !!cuenta.data,
  });
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const [agregar, setAgregar] = useState(false);
  const [error, setError] = useState<string>();

  const cerrar = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: 'ASIGNADA' | 'CANCELADA' }) =>
      datos(api.POST('/api/lista-espera/{id}/cierre', { params: { path: { id } }, body: { estado } })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['panel', 'lista-espera'] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos actualizar la lista de espera.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[560px] text-[13.5px] font-semibold text-neutral-800">
          Cuando se libera una hora apartada, avisamos a quienes esperan. Agenda la hora y marca la entrada como asignada.
        </p>
        <Button variant="secondary" icon="add" onClick={() => setAgregar(true)} className="!py-2.5">
          Agregar a la lista
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Nadie en lista de espera">
        {(l) => (
          <Tabla etiqueta="Lista de espera">
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Espera a</Th>
                <Th>Preferencias</Th>
                <Th>Desde</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {l.map((e) => (
                <tr key={e.id}>
                  <Td className="font-extrabold">{nombres.get(e.pacienteId) ?? 'Paciente'}</Td>
                  <Td className="font-semibold">{e.profesionalId ? (profesional.get(e.profesionalId) ?? 'Profesional') : 'Por tipo de atención'}</Td>
                  <Td className="max-w-[240px] text-[13px] font-semibold text-neutral-800">{e.preferencias ?? '—'}</Td>
                  <Td className="font-semibold text-neutral-800">
                    {formatoFecha(e.creadaEn)}
                    {e.avisadaEn && <span className="block text-[12px] text-accent-800">Avisada {formatoFecha(e.avisadaEn)}</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <ButtonLink href={`/admin/agenda?paciente=${e.pacienteId}`} variant="ghost" icon="event" className="!px-3.5 !py-2 !text-[12.5px]">
                        Agendar
                      </ButtonLink>
                      <Button
                        variant="ghost"
                        icon="check"
                        onClick={() => cerrar.mutate({ id: e.id, estado: 'ASIGNADA' })}
                        className="!px-3.5 !py-2 !text-[12.5px]"
                      >
                        Asignada
                      </Button>
                      <Button
                        variant="ghost"
                        icon="close"
                        onClick={() => cerrar.mutate({ id: e.id, estado: 'CANCELADA' })}
                        className="!px-3.5 !py-2 !text-[12.5px]"
                      >
                        Quitar
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </EstadoConsulta>
      <AgregarListaEspera abierto={agregar} onCerrar={() => setAgregar(false)} profesionalInicial={filtro} />
    </div>
  );
}

function AgregarListaEspera({ abierto, onCerrar, profesionalInicial }: { abierto: boolean; onCerrar: () => void; profesionalInicial?: string }) {
  const cliente = useQueryClient();
  const pacientes = usePacientes({}, abierto);
  const equipo = useEquipoAgenda();
  const [pacienteId, setPacienteId] = useState('');
  const [profesionalId, setProfesionalId] = useState(profesionalInicial ?? '');
  const [preferencias, setPreferencias] = useState('');
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () => datos(api.POST('/api/lista-espera', { body: { pacienteId, profesionalId, preferencias: preferencias.trim() || undefined } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'lista-espera'] });
      setPacienteId('');
      setPreferencias('');
      setError(undefined);
      onCerrar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos agregarlo a la lista.'),
  });
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Agregar a la lista de espera" descripcion="Recibe un aviso cuando se libere una hora del profesional.">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pacienteId || !profesionalId) return setError('Elige el paciente y el profesional al que espera.');
          crear.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Paciente" required>
          {(p) => (
            <Select {...p} value={pacienteId} onChange={(e) => setPacienteId(e.target.value)}>
              <option value="">{pacientes.isPending ? 'Cargando pacientes…' : 'Elige un paciente'}</option>
              {pacientes.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.apellido}, {x.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Profesional" required>
          {(p) => (
            <Select {...p} value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
              <option value="">Elige un profesional</option>
              {equipo.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre ?? 'Profesional'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Preferencias (opcional)" hint="Días u horarios que le acomodan. No escribas datos clínicos.">
          {(p) => <Textarea {...p} rows={2} maxLength={500} value={preferencias} onChange={(e) => setPreferencias(e.target.value)} className="!min-h-16" />}
        </Field>
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
            Agregar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
