'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoTelefono } from '@/lib/formato';
import { clavesPortal, useContactosEmergencia, type ContactoEmergencia } from '@/lib/portal';
import { MENSAJE_TELEFONO, reglaTelefono } from '@/lib/validacion';

const MAXIMO = 5;
const telefonoApi = (t: string) => t.replace(/[\s()-]/g, '');
const vacio = { nombre: '', parentesco: '', telefono: '' };

/**
 * Punto 38: los contactos de emergencia los agrega el paciente (o su adulto
 * responsable). Puede tener varios; no es obligatorio. Su profesional ve que
 * existen y el parentesco; nombre y telefono solo en una emergencia (queda
 * registrado). Vive en "Mis datos y seguridad".
 */
export function ContactosEmergenciaPortal() {
  const portal = usePortal();
  const consulta = useContactosEmergencia(portal.pacienteParam, !portal.cargando && !!portal.pacienteId);
  const [editando, setEditando] = useState<string | 'nuevo' | null>(null);
  return (
    <Panel
      id="contactos-emergencia"
      titulo="Contactos de emergencia"
      bajada="A quién llamar si lo necesitas durante tu atención. Tu profesional solo ve que existen y el parentesco; sus datos los abre únicamente en una emergencia, y queda registrado."
    >
      <EstadoConsulta consulta={consulta}>
        {(lista) => (
          <div className="flex flex-col gap-3">
            {lista.length === 0 && editando !== 'nuevo' && (
              <p className="m-0 rounded-lg bg-pendiente-100 p-3.5 text-[13.5px] font-bold text-pendiente-900">
                Todavía no agregas ninguno. Te recomendamos dejar al menos uno.
              </p>
            )}
            {lista.map((c) =>
              editando === c.id ? (
                <FormularioContacto key={c.id} inicial={c} onListo={() => setEditando(null)} />
              ) : (
                <FilaContacto key={c.id} contacto={c} onEditar={() => setEditando(c.id)} />
              ),
            )}
            {editando === 'nuevo' ? (
              <FormularioContacto onListo={() => setEditando(null)} />
            ) : (
              lista.length < MAXIMO && (
                <Button variant="secondary" icon="add" onClick={() => setEditando('nuevo')} className="self-start">
                  Agregar contacto
                </Button>
              )
            )}
          </div>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

function FilaContacto({ contacto: c, onEditar }: { contacto: ContactoEmergencia; onEditar: () => void }) {
  const portal = usePortal();
  const cliente = useQueryClient();
  const eliminar = useMutation({
    mutationFn: () => datos(api.DELETE('/api/portal/contactos-emergencia/{id}', { params: { path: { id: c.id } } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesPortal.contactos(portal.pacienteParam) }),
  });
  const [confirmar, setConfirmar] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-divider bg-bg px-4 py-3">
      <Icon name="call" size={20} className="text-accent-2-700" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[14.5px] font-extrabold">
          {c.nombre} <span className="font-semibold text-neutral-700">· {c.parentesco}</span>
        </p>
        <p className="m-0 text-[13px] font-semibold text-neutral-800">{formatoTelefono(c.telefono)}</p>
      </div>
      {confirmar ? (
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-bold">¿Eliminar?</span>
          <Button variant="ghost" onClick={() => setConfirmar(false)} className="!px-3 !py-1.5 !text-[13px]">
            No
          </Button>
          <Button variant="secondary" loading={eliminar.isPending} onClick={() => eliminar.mutate()} className="!px-3 !py-1.5 !text-[13px]">
            Sí, eliminar
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Button variant="ghost" icon="edit" onClick={onEditar} className="!px-3 !py-1.5 !text-[13px]">
            Modificar
          </Button>
          <Button variant="ghost" icon="delete" onClick={() => setConfirmar(true)} className="!px-3 !py-1.5 !text-[13px]">
            Eliminar
          </Button>
        </span>
      )}
      {eliminar.error && (
        <p role="alert" className="m-0 w-full text-[13px] font-bold text-accent-700">
          {eliminar.error instanceof ApiError ? eliminar.error.message : 'No pudimos eliminarlo.'}
        </p>
      )}
    </div>
  );
}

function FormularioContacto({ inicial, onListo }: { inicial?: ContactoEmergencia; onListo: () => void }) {
  const portal = usePortal();
  const cliente = useQueryClient();
  const [d, setD] = useState(inicial ? { nombre: inicial.nombre, parentesco: inicial.parentesco, telefono: formatoTelefono(inicial.telefono) } : vacio);
  const [errores, setErrores] = useState<Partial<Record<keyof typeof vacio, string>>>({});
  const guardar = useMutation({
    mutationFn: () => {
      const body = { pacienteId: portal.pacienteParam, nombre: d.nombre.trim(), parentesco: d.parentesco.trim(), telefono: telefonoApi(d.telefono) };
      return datos(
        inicial
          ? api.PATCH('/api/portal/contactos-emergencia/{id}', { params: { path: { id: inicial.id } }, body })
          : api.POST('/api/portal/contactos-emergencia', { body }),
      );
    },
    onSuccess: (lista) => {
      cliente.setQueryData(clavesPortal.contactos(portal.pacienteParam), lista);
      onListo();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const err: typeof errores = {};
    if (!d.nombre.trim()) err.nombre = 'Escribe su nombre.';
    if (!d.parentesco.trim()) err.parentesco = 'Indica qué es de ti (madre, pareja, amigo…).';
    if (reglaTelefono(telefonoApi(d.telefono)) || !d.telefono.trim()) err.telefono = MENSAJE_TELEFONO;
    setErrores(err);
    if (Object.keys(err).length === 0) guardar.mutate();
  };
  const cambiar = (k: keyof typeof vacio) => (v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrores((x) => ({ ...x, [k]: undefined }));
  };
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded-lg border border-accent-2-500 bg-accent-2-100 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" required error={errores.nombre}>
          {(p) => <Input {...p} maxLength={120} value={d.nombre} onChange={(e) => cambiar('nombre')(e.target.value)} />}
        </Field>
        <Field label="Parentesco" required error={errores.parentesco}>
          {(p) => (
            <Input {...p} maxLength={60} placeholder="Madre, pareja, amigo…" value={d.parentesco} onChange={(e) => cambiar('parentesco')(e.target.value)} />
          )}
        </Field>
        <Field label="Teléfono" required error={errores.telefono} hint="Con código de país, por ejemplo +56 9 1234 5678.">
          {(p) => <Input {...p} type="tel" autoComplete="off" value={d.telefono} onChange={(e) => cambiar('telefono')(e.target.value)} />}
        </Field>
      </div>
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardarlo. Intenta de nuevo.'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={guardar.isPending}>
          {inicial ? 'Guardar cambios' : 'Agregar'}
        </Button>
      </div>
    </form>
  );
}

/** Inicio del portal: si tiene contacto de emergencia (sin sus datos) o la invitacion a agregar uno. */
export function ResumenContactosPortal() {
  const portal = usePortal();
  const consulta = useContactosEmergencia(portal.pacienteParam, !portal.cargando && !!portal.pacienteId);
  if (!consulta.data) return null;
  const n = consulta.data.length;
  return (
    <section
      aria-label="Contacto de emergencia"
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-5 py-4 ${n ? 'border-divider bg-bg' : 'border-divider bg-pendiente-100'}`}
    >
      <Icon name="call" size={22} className={n ? 'text-accent-2-700' : 'text-pendiente-900'} />
      <p className="m-0 min-w-0 flex-1 text-[14px] font-bold">
        {n
          ? `Contacto de emergencia: ${consulta.data.map((c) => c.parentesco).join(', ')}`
          : 'Aún no tienes un contacto de emergencia. Te recomendamos agregar uno.'}
      </p>
      <ButtonLink href="/portal/seguridad?seccion=contactos" variant={n ? 'ghost' : 'outlinePatient'} className="!py-2 !text-[13px]">
        {n ? 'Ver o modificar' : 'Agregar'}
      </ButtonLink>
    </section>
  );
}
