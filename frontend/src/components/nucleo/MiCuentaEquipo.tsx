'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { formatoFecha } from '@/lib/formato';

const ROL = {
  ADMIN: 'Cuenta madre',
  GESTION: 'Gestión',
  PROFESIONAL: 'Profesional',
  PRACTICANTE: 'Practicante',
  PACIENTE: 'Paciente',
  RESPONSABLE: 'Adulto responsable',
} as const;

/**
 * Datos de la cuenta propia (diseño "Mi Perfil", Mi cuenta): nombre, correo y
 * telefono de contacto interno. El rol y el acceso los administra la cuenta
 * madre; el segundo factor se configura al ingresar.
 */
export function MiCuentaEquipo() {
  const cuenta = useMiCuenta();
  return <EstadoConsulta consulta={cuenta}>{(c) => <Formulario key={c.id} c={c} />}</EstadoConsulta>;
}

function Formulario({ c }: { c: NonNullable<ReturnType<typeof useMiCuenta>['data']> }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ nombre: c.nombre ?? '', email: c.email ?? '', telefono: c.telefono ?? '' });
  const [estado, setEstado] = useState<{ error?: string; ok?: boolean }>({});
  const guardar = useMutation({
    mutationFn: () =>
      datos(api.PATCH('/api/usuarios/yo', { body: { nombre: f.nombre.trim(), email: f.email.trim().toLowerCase(), telefono: f.telefono.trim() || null } })),
    onSuccess: () => {
      setEstado({ ok: true });
      void cliente.invalidateQueries({ queryKey: ['usuarios', 'yo'] });
    },
    onError: (e) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar tus datos.' }),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!f.nombre.trim() || !/^\S+@\S+\.\S+$/.test(f.email.trim())) return setEstado({ error: 'Escribe tu nombre y un correo válido.' });
    guardar.mutate();
  };
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setEstado({});
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  return (
    <Panel
      titulo="Mi cuenta"
      bajada="Datos de contacto dentro del equipo. El rol y el acceso los administra la cuenta madre."
      accion={
        <div className="flex flex-wrap gap-1.5">
          {[c.rol, ...c.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol)].map((r) => (
            <Badge key={r}>{ROL[r]}</Badge>
          ))}
          <Badge tono={c.totpActivo ? 'positivo' : 'neutro'}>{c.totpActivo ? 'Segundo factor activo' : 'Sin segundo factor'}</Badge>
        </div>
      }
    >
      <form onSubmit={enviar} noValidate className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre" required>
            {(x) => <Input {...x} value={f.nombre} maxLength={120} onChange={cambiar('nombre')} />}
          </Field>
          <Field label="Correo" required hint="Con él ingresas al panel.">
            {(x) => <Input {...x} type="email" autoComplete="email" value={f.email} onChange={cambiar('email')} />}
          </Field>
          <Field label="Teléfono" hint="+56XXXXXXXXX">
            {(x) => <Input {...x} type="tel" autoComplete="tel" value={f.telefono} onChange={cambiar('telefono')} />}
          </Field>
        </div>
        {c.fechaExpiracionAcceso && (
          <p className="m-0 text-[13px] font-semibold text-neutral-800">Tu acceso termina el {formatoFecha(c.fechaExpiracionAcceso)}.</p>
        )}
        {estado.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {estado.error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {estado.ok && (
            <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
              Datos guardados.
            </p>
          )}
          <Button type="submit" variant="team" icon="save" loading={guardar.isPending}>
            Guardar mis datos
          </Button>
        </div>
      </form>
    </Panel>
  );
}
