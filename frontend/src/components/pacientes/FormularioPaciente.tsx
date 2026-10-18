'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { edadEn } from '@/lib/condiciones';
import { useProfesionales } from '@/lib/consultas';
import { formatoRut, rutValido } from '@/lib/formato';
import { useTiposAtencion, type PacienteVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

const vacio = {
  nombre: '',
  apellido: '',
  rut: '',
  fechaNacimiento: '',
  email: '',
  telefono: '',
  profesionalId: '',
  tipoAtencionId: '',
  contactoEmergencia: '',
  adultoNombre: '',
  adultoParentesco: '',
  adultoTelefono: '',
  adultoEmail: '',
};
type Datos = typeof vacio;
type Errores = Partial<Record<keyof Datos, string>>;

const telefono = (t: string) => t.replace(/[\s()-]/g, '');
const telefonoValido = (t: string) => !t || /^\+56\d{9}$/.test(telefono(t));
const correoValido = (c: string) => !c || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim());

/**
 * Alta de paciente (datos administrativos). PROFESIONAL lo crea como propio;
 * ADMIN/GESTION eligen el tratante. Si la fecha de nacimiento es de un menor,
 * anticipa el adulto responsable (la BD exige uno antes de agendar: se pide
 * aca para que no se tope despues). RUT opcional aqui; obligatorio antes de
 * la primera evolucion (lo registra recepcion o el tratante).
 */
export function FormularioPaciente({ rol, onCreado, onCancelar }: { rol: Rol; onCreado: (p: PacienteVista) => void; onCancelar: () => void }) {
  const admin = esAdministracion(rol);
  const profesionales = useProfesionales(admin);
  const tipos = useTiposAtencion();
  const cliente = useQueryClient();
  const [d, setD] = useState<Datos>(vacio);
  const [errores, setErrores] = useState<Errores>({});
  const alerta = useRef<HTMLParagraphElement>(null);
  const cambiar = (k: keyof Datos, v: string) => setD((x) => ({ ...x, [k]: v }));
  const menor = d.fechaNacimiento ? edadEn(d.fechaNacimiento) < 18 : false;

  const crear = useMutation({
    mutationFn: async () => {
      const p = await datos(
        api.POST('/api/pacientes', {
          body: {
            nombre: d.nombre.trim(),
            apellido: d.apellido.trim(),
            rut: d.rut.trim() || undefined,
            fechaNacimiento: d.fechaNacimiento,
            email: d.email.trim().toLowerCase() || undefined,
            telefono: d.telefono ? telefono(d.telefono) : undefined,
            profesionalId: admin ? d.profesionalId : undefined,
            tipoAtencionId: d.tipoAtencionId || undefined,
            contactoEmergencia: d.contactoEmergencia.trim() || undefined,
          },
        }),
      );
      if (menor) {
        await datos(
          api.POST('/api/pacientes/{id}/adultos-responsables', {
            params: { path: { id: p.id } },
            body: {
              nombre: d.adultoNombre.trim(),
              parentesco: d.adultoParentesco.trim() || undefined,
              telefono: d.adultoTelefono ? telefono(d.adultoTelefono) : undefined,
              email: d.adultoEmail.trim().toLowerCase() || undefined,
            },
          }),
        );
      }
      return p;
    },
    onSuccess: (p) => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'pacientes'] });
      onCreado(p);
    },
  });
  useEffect(() => {
    if (crear.error) alerta.current?.focus();
  }, [crear.error]);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const err: Errores = {};
    if (!d.nombre.trim()) err.nombre = 'Escribe el nombre.';
    if (!d.apellido.trim()) err.apellido = 'Escribe el apellido.';
    if (!d.fechaNacimiento) err.fechaNacimiento = 'La fecha de nacimiento es obligatoria (define si es menor de edad).';
    else if (new Date(d.fechaNacimiento) > new Date()) err.fechaNacimiento = 'La fecha no puede ser futura.';
    if (d.rut && !rutValido(d.rut)) err.rut = 'El RUT no es válido. Revisa el dígito verificador.';
    if (!correoValido(d.email)) err.email = 'Revisa el correo.';
    if (!telefonoValido(d.telefono)) err.telefono = 'Con código de país: +56 9 1234 5678.';
    if (admin && !d.profesionalId) err.profesionalId = 'Elige el profesional tratante.';
    if (menor) {
      if (!d.adultoNombre.trim()) err.adultoNombre = 'Un menor necesita un adulto responsable para agendar.';
      if (!telefonoValido(d.adultoTelefono)) err.adultoTelefono = 'Con código de país: +56 9 1234 5678.';
      if (!correoValido(d.adultoEmail)) err.adultoEmail = 'Revisa el correo.';
    }
    setErrores(err);
    if (Object.keys(err).length === 0) crear.mutate();
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required error={errores.nombre}>
          {(p) => <Input {...p} autoComplete="off" value={d.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
        </Field>
        <Field label="Apellido" required error={errores.apellido}>
          {(p) => <Input {...p} autoComplete="off" value={d.apellido} onChange={(e) => cambiar('apellido', e.target.value)} />}
        </Field>
        <Field label="Fecha de nacimiento" required error={errores.fechaNacimiento}>
          {(p) => <Input {...p} type="date" value={d.fechaNacimiento} onChange={(e) => cambiar('fechaNacimiento', e.target.value)} />}
        </Field>
        <Field label="RUT" hint="Opcional ahora; se exige antes de la primera evolución." error={errores.rut}>
          {(p) => (
            <Input
              {...p}
              inputMode="text"
              placeholder="12.345.678-9"
              value={d.rut}
              onChange={(e) => cambiar('rut', e.target.value)}
              onBlur={() => d.rut && cambiar('rut', formatoRut(d.rut))}
            />
          )}
        </Field>
        <Field label="Correo" error={errores.email}>
          {(p) => <Input {...p} type="email" value={d.email} onChange={(e) => cambiar('email', e.target.value)} />}
        </Field>
        <Field label="Teléfono" error={errores.telefono}>
          {(p) => <Input {...p} type="tel" placeholder="+56 9 1234 5678" value={d.telefono} onChange={(e) => cambiar('telefono', e.target.value)} />}
        </Field>
        {admin && (
          <Field label="Profesional tratante" required error={errores.profesionalId}>
            {(p) => (
              <Select {...p} value={d.profesionalId} onChange={(e) => cambiar('profesionalId', e.target.value)}>
                <option value="">Elige un profesional</option>
                {profesionales.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre ?? 'Sin nombre'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Tipo de atención">
          {(p) => (
            <Select {...p} value={d.tipoAtencionId} onChange={(e) => cambiar('tipoAtencionId', e.target.value)}>
              <option value="">Sin definir</option>
              {tipos.data
                ?.filter((t) => t.activo)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Contacto de emergencia" hint="Nombre, relación y teléfono. Se guarda cifrado.">
        {(p) => (
          <Textarea
            {...p}
            rows={2}
            maxLength={500}
            value={d.contactoEmergencia}
            onChange={(e) => cambiar('contactoEmergencia', e.target.value)}
            className="!min-h-16"
          />
        )}
      </Field>

      {menor && (
        <fieldset className="m-0 flex flex-col gap-4 rounded-[18px] border border-accent-500 bg-accent-100 px-[18px] pt-3 pb-4">
          <legend className="flex items-center gap-2 px-1 text-[13.5px] font-black text-accent-900">
            <Icon name="family_restroom" size={19} />
            Adulto responsable (menor de 18)
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" required error={errores.adultoNombre}>
              {(p) => <Input {...p} value={d.adultoNombre} onChange={(e) => cambiar('adultoNombre', e.target.value)} />}
            </Field>
            <Field label="Relación">
              {(p) => (
                <Input {...p} placeholder="Madre, padre, tutor…" value={d.adultoParentesco} onChange={(e) => cambiar('adultoParentesco', e.target.value)} />
              )}
            </Field>
            <Field label="Teléfono" error={errores.adultoTelefono}>
              {(p) => <Input {...p} type="tel" value={d.adultoTelefono} onChange={(e) => cambiar('adultoTelefono', e.target.value)} />}
            </Field>
            <Field label="Correo" hint="Recibe los avisos y consentimientos del menor." error={errores.adultoEmail}>
              {(p) => <Input {...p} type="email" value={d.adultoEmail} onChange={(e) => cambiar('adultoEmail', e.target.value)} />}
            </Field>
          </div>
        </fieldset>
      )}

      {crear.error && (
        <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {crear.error instanceof ApiError ? crear.error.message : 'No pudimos crear el paciente.'}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" variant="team" icon="person_add" loading={crear.isPending}>
          Crear paciente
        </Button>
      </div>
    </form>
  );
}

/** Resultado del alta: siguiente paso natural (ficha o agendar). */
export function PacienteCreado({ paciente, onCerrar }: { paciente: PacienteVista; onCerrar: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Aviso tono="exito" titulo={`${paciente.nombre} ${paciente.apellido} quedó registrado`}>
        {paciente.rut ? 'Con RUT registrado.' : 'Falta el RUT: regístralo antes de la primera evolución.'}
      </Aviso>
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" onClick={onCerrar}>
          Cerrar
        </Button>
        <ButtonLink href={`/admin/fichas/${paciente.id}`} variant="secondary" icon="folder_shared">
          Ver paciente
        </ButtonLink>
        <ButtonLink href={`/admin/agenda?paciente=${paciente.id}`} variant="team" icon="event">
          Agendar sesión
        </ButtonLink>
      </div>
    </div>
  );
}
