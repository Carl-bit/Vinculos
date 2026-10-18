'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useProfesionales } from '@/lib/consultas';
import { NOMBRE_ROL } from '@/lib/equipo';

type RolEquipo = 'PROFESIONAL' | 'PRACTICANTE' | 'GESTION' | 'ADMIN';
const ROLES: RolEquipo[] = ['PROFESIONAL', 'PRACTICANTE', 'GESTION', 'ADMIN'];
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

/**
 * Nueva cuenta del equipo (solo ADMIN). Sin contraseña: le llega una
 * invitacion de un solo uso por correo. Un practicante nace con supervisor,
 * fechas de practica y fecha de termino del acceso (RF-27).
 */
export function NuevaCuenta({ abierto, onCerrar, onCreada }: { abierto: boolean; onCerrar: () => void; onCreada: (id: string) => void }) {
  const cliente = useQueryClient();
  const profesionales = useProfesionales(true);
  const [f, setF] = useState({
    nombre: '',
    email: '',
    telefono: '',
    rol: 'PROFESIONAL' as RolEquipo,
    supervisorId: '',
    inicio: hoy(),
    termino: '',
    expira: '',
  });
  const [error, setError] = useState<string>();
  const practicante = f.rol === 'PRACTICANTE';
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/usuarios', {
          body: {
            nombre: f.nombre.trim(),
            email: f.email.trim().toLowerCase(),
            telefono: f.telefono.trim() || undefined,
            rol: f.rol,
            ...(practicante
              ? { supervisorId: f.supervisorId, fechaInicioPractica: f.inicio, fechaTerminoPractica: f.termino, fechaExpiracionAcceso: f.expira }
              : {}),
          },
        }),
      ),
    onSuccess: (u) => {
      void cliente.invalidateQueries({ queryKey: ['equipo'] });
      void cliente.invalidateQueries({ queryKey: ['directorio'] });
      setError(undefined);
      onCreada(u.id);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos crear la cuenta.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!f.nombre.trim() || !/^\S+@\S+\.\S+$/.test(f.email.trim())) return setError('Escribe el nombre y un correo válido.');
    if (practicante && (!f.supervisorId || !f.termino || !f.expira))
      return setError('Un practicante necesita supervisor, término de la práctica y fecha de término del acceso.');
    if (practicante && f.termino < f.inicio) return setError('El término de la práctica debe ser posterior al inicio.');
    crear.mutate();
  };
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nueva cuenta del equipo"
      descripcion="Le llega un correo para fijar su contraseña (enlace de un solo uso)."
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Field label="Nombre completo" required>
          {(x) => <Input {...x} value={f.nombre} maxLength={120} onChange={cambiar('nombre')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo" required>
            {(x) => <Input {...x} type="email" value={f.email} onChange={cambiar('email')} />}
          </Field>
          <Field label="Teléfono (opcional)" hint="+56XXXXXXXXX">
            {(x) => <Input {...x} type="tel" value={f.telefono} onChange={cambiar('telefono')} />}
          </Field>
        </div>
        <Field label="Rol" required hint="Una cuenta de gestión o cuenta madre puede sumar después el rol profesional.">
          {(x) => (
            <Select {...x} value={f.rol} onChange={(e) => setF((y) => ({ ...y, rol: e.target.value as RolEquipo }))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_ROL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {practicante && (
          <>
            <Field label="Supervisor" required>
              {(x) => (
                <Select {...x} value={f.supervisorId} onChange={cambiar('supervisorId')}>
                  <option value="">Elige un profesional</option>
                  {profesionales.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre ?? 'Profesional'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Inicio de la práctica" required>
                {(x) => <Input {...x} type="date" value={f.inicio} onChange={cambiar('inicio')} />}
              </Field>
              <Field label="Término de la práctica" required>
                {(x) => <Input {...x} type="date" min={f.inicio} value={f.termino} onChange={cambiar('termino')} />}
              </Field>
              <Field label="Acceso hasta" required>
                {(x) => <Input {...x} type="date" min={hoy()} value={f.expira} onChange={cambiar('expira')} />}
              </Field>
            </div>
          </>
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
          <Button type="submit" variant="team" icon="person_add" loading={crear.isPending}>
            Crear e invitar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
