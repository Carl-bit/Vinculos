'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EnlaceVolver } from '@/components/ui/EnlaceVolver';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFecha, formatoRut, rutValido } from '@/lib/formato';
import { usePaciente, useTiposAtencion, type PacienteVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { AccesosPaciente } from './AccesosTemporales';
import { CrearDerivacion } from './CrearDerivacion';
import { SolicitudesEpicrisis } from './SolicitudesEpicrisis';
import {
  AccesoFicha,
  AdultosResponsables,
  ConsentimientoPaciente,
  CuentaPaciente,
  DerivacionRecibida,
  HistorialSesiones,
  IndicacionesPaciente,
} from './SeccionesPaciente';

/**
 * Detalle del paciente (diseño "Fichas y Pacientes", lado administrativo):
 * datos, RUT para recepcion, adulto responsable, consentimiento, cuenta e
 * historial de sesiones. El contenido clinico (ingreso, evoluciones,
 * documentos) se abre desde "Ficha clinica" y lo ve solo quien tiene acceso.
 */
export function DetallePaciente({ id, rol }: { id: string; rol: Rol }) {
  const consulta = usePaciente(id);
  const cuenta = useMiCuenta();
  const tipos = useTiposAtencion();
  const [editar, setEditar] = useState(false);
  const router = useRouter();
  // `?derivar=1`: llega desde el detalle de una sesion en la agenda ("Derivar paciente").
  const [derivar, setDerivar] = useState(useSearchParams().get('derivar') === '1');
  const cerrarDerivar = () => {
    setDerivar(false);
    router.replace(`/admin/fichas/${id}`, { scroll: false });
  };
  return (
    <EstadoConsulta consulta={consulta}>
      {(p) => {
        const admin = esAdministracion(rol);
        const tratante = !!cuenta.data?.id && p.profesionalId === cuenta.data.id;
        const edad = edadEn(p.fechaNacimiento);
        const tipo = tipos.data?.find((t) => t.id === p.tipoAtencionId)?.nombre;
        return (
          <>
            <EnlaceVolver href="/admin/fichas">Volver al listado</EnlaceVolver>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(28px,3.4vw,36px)] leading-[1.05] font-black tracking-[-0.03em]">
                    {p.nombre} {p.apellido}
                  </h1>
                  {edad < 18 && <Badge tono="atencion">Menor de edad</Badge>}
                </div>
                <p className="m-0 mt-1.5 text-[14px] font-semibold text-neutral-800">
                  {edad} años · {formatoFecha(p.fechaNacimiento.slice(0, 10))}
                  {tipo ? ` · ${tipo}` : ''}
                  {p.rut ? ` · RUT ${formatoRut(p.rut)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="secondary" icon="edit" onClick={() => setEditar(true)}>
                  Editar datos
                </Button>
                {tratante && rol === 'PROFESIONAL' && (
                  <Button variant="secondary" icon="call_split" onClick={() => setDerivar(true)}>
                    Derivar paciente
                  </Button>
                )}
                <ButtonLink href={`/admin/agenda?paciente=${p.id}`} variant="team" icon="event">
                  Agendar sesión
                </ButtonLink>
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3">
              {!p.rut && <RegistroRut paciente={p} />}
              {p.posibleDuplicado && <Duplicado paciente={p} admin={admin} />}
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="flex min-w-0 flex-col gap-4">
                <DerivacionRecibida pacienteId={p.id} habilitado={rol === 'ADMIN' || tratante} />
                {(rol === 'PROFESIONAL' || rol === 'PRACTICANTE') && tratante && <IndicacionesPaciente pacienteId={p.id} />}
                <HistorialSesiones paciente={p} rol={rol} tratante={tratante} />
                {admin && <SolicitudesEpicrisis pacienteId={p.id} puedeResolver={rol === 'ADMIN'} />}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <AccesoFicha paciente={p} rol={rol} tratante={tratante} />
                <AdultosResponsables paciente={p} />
                <ConsentimientoPaciente paciente={p} rol={rol} />
                {rol === 'ADMIN' && <AccesosPaciente pacienteId={p.id} tratanteId={p.profesionalId} puedeOtorgar />}
                {admin && <CuentaPaciente paciente={p} />}
              </div>
            </div>
            {tratante && <CrearDerivacion paciente={p} abierto={derivar} onCerrar={cerrarDerivar} />}
            <Modal abierto={editar} onCerrar={() => setEditar(false)} titulo="Editar datos del paciente" ancho="lg">
              {editar && <EditarPaciente paciente={p} onListo={() => setEditar(false)} />}
            </Modal>
          </>
        );
      }}
    </EstadoConsulta>
  );
}

/** Recepcion: el RUT es obligatorio antes de la primera evolucion (la BD lo exige). */
function RegistroRut({ paciente }: { paciente: PacienteVista }) {
  const cliente = useQueryClient();
  const [rut, setRut] = useState('');
  const [error, setError] = useState<string>();
  const guardar = useMutation({
    mutationFn: () => datos(api.PATCH('/api/pacientes/{id}', { params: { path: { id: paciente.id } }, body: { rut: rut.trim() } })),
    onSuccess: (p) => cliente.setQueryData(['panel', 'paciente', paciente.id], p),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el RUT.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!rutValido(rut)) {
      setError('El RUT no es válido. Revisa el dígito verificador.');
      return;
    }
    setError(undefined);
    guardar.mutate();
  };
  return (
    <Aviso tono="advertencia" icono="badge" titulo="Falta el RUT del paciente">
      <p className="m-0 mb-3">Regístralo en recepción: se exige antes de la primera evolución y evita registros duplicados.</p>
      <form onSubmit={enviar} noValidate className="flex flex-wrap items-start gap-2.5">
        <div className="w-full max-w-[240px]">
          <Field label="RUT" error={error}>
            {(p) => (
              <Input
                {...p}
                placeholder="12.345.678-9"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                onBlur={() => rut && setRut(formatoRut(rut))}
                className="!bg-neutral-100 !py-2.5"
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending} className="mt-[26px]">
          Guardar RUT
        </Button>
      </form>
    </Aviso>
  );
}

/** Posible duplicado (D-2): nunca se fusiona por nombre; solo administracion concilia y queda auditado. */
function Duplicado({ paciente, admin }: { paciente: PacienteVista; admin: boolean }) {
  const cliente = useQueryClient();
  const [confirmar, setConfirmar] = useState<'DISTINTO' | 'MISMO_PACIENTE' | null>(null);
  const resolver = useMutation({
    mutationFn: (resolucion: 'DISTINTO' | 'MISMO_PACIENTE') =>
      datos(api.POST('/api/pacientes/{id}/duplicado-revisado', { params: { path: { id: paciente.id } }, body: { resolucion } })),
    onSuccess: (p) => {
      setConfirmar(null);
      cliente.setQueryData(['panel', 'paciente', paciente.id], p);
      void cliente.invalidateQueries({ queryKey: ['panel', 'pacientes'] });
    },
  });
  return (
    <Aviso
      tono="advertencia"
      icono="person_search"
      titulo="Posible duplicado"
      accion={
        admin ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmar('DISTINTO')} className="!py-2.5">
              Es otra persona
            </Button>
            <Button variant="secondary" onClick={() => setConfirmar('MISMO_PACIENTE')} className="!py-2.5">
              Es el mismo paciente
            </Button>
          </>
        ) : undefined
      }
    >
      {admin
        ? 'Otro registro coincide en RUT o correo. Revisa ambos antes de decidir: la resolución queda auditada.'
        : 'Otro registro coincide en RUT o correo. Lo concilia administración.'}
      <Modal
        abierto={!!confirmar}
        onCerrar={() => setConfirmar(null)}
        titulo={confirmar === 'DISTINTO' ? '¿Es otra persona?' : '¿Es el mismo paciente?'}
        descripcion={
          confirmar === 'DISTINTO'
            ? 'Se quita la marca de posible duplicado. Los dos registros siguen separados.'
            : 'Queda registrado que ambos registros son la misma persona. Los registros no se fusionan solos: el traspaso de fichas se hace aparte.'
        }
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmar(null)}>
              Volver
            </Button>
            <Button variant="team" loading={resolver.isPending} onClick={() => confirmar && resolver.mutate(confirmar)}>
              Confirmar
            </Button>
          </>
        }
      >
        {resolver.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {resolver.error instanceof ApiError ? resolver.error.message : 'No pudimos registrar la resolución.'}
          </p>
        )}
      </Modal>
    </Aviso>
  );
}

function EditarPaciente({ paciente, onListo }: { paciente: PacienteVista; onListo: () => void }) {
  const cliente = useQueryClient();
  const [d, setD] = useState({
    nombre: paciente.nombre,
    apellido: paciente.apellido,
    fechaNacimiento: paciente.fechaNacimiento.slice(0, 10),
    email: paciente.email ?? '',
    telefono: paciente.telefono ?? '',
    contactoEmergencia: paciente.contactoEmergencia ?? '',
  });
  const [error, setError] = useState<string>();
  const cambiar = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/pacientes/{id}', {
          params: { path: { id: paciente.id } },
          body: {
            nombre: d.nombre.trim(),
            apellido: d.apellido.trim(),
            fechaNacimiento: d.fechaNacimiento,
            email: d.email.trim().toLowerCase() || undefined,
            telefono: d.telefono.replace(/[\s()-]/g, '') || undefined,
            contactoEmergencia: d.contactoEmergencia.trim() || undefined,
          },
        }),
      ),
    onSuccess: (p) => {
      cliente.setQueryData(['panel', 'paciente', paciente.id], p);
      void cliente.invalidateQueries({ queryKey: ['panel', 'pacientes'] });
      onListo();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar los cambios.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!d.nombre.trim() || !d.apellido.trim() || !d.fechaNacimiento) {
      setError('Nombre, apellido y fecha de nacimiento son obligatorios.');
      return;
    }
    if (d.telefono && !/^\+56\d{9}$/.test(d.telefono.replace(/[\s()-]/g, ''))) {
      setError('Teléfono con código de país: +56 9 1234 5678.');
      return;
    }
    setError(undefined);
    guardar.mutate();
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required>
          {(p) => <Input {...p} value={d.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
        </Field>
        <Field label="Apellido" required>
          {(p) => <Input {...p} value={d.apellido} onChange={(e) => cambiar('apellido', e.target.value)} />}
        </Field>
        <Field label="Fecha de nacimiento" required hint="Define si es menor de edad: la BD exige adulto responsable para agendar a un menor.">
          {(p) => <Input {...p} type="date" value={d.fechaNacimiento} onChange={(e) => cambiar('fechaNacimiento', e.target.value)} />}
        </Field>
        <Field label="Correo">{(p) => <Input {...p} type="email" value={d.email} onChange={(e) => cambiar('email', e.target.value)} />}</Field>
        <Field label="Teléfono">{(p) => <Input {...p} type="tel" value={d.telefono} onChange={(e) => cambiar('telefono', e.target.value)} />}</Field>
      </div>
      <Field label="Contacto de emergencia" hint="Nombre, relación y teléfono. Se guarda cifrado.">
        {(p) => <Textarea {...p} rows={2} value={d.contactoEmergencia} onChange={(e) => cambiar('contactoEmergencia', e.target.value)} className="!min-h-16" />}
      </Field>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
