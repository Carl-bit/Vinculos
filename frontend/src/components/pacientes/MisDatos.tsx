'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora, formatoTelefono } from '@/lib/formato';
import { clavesPortal, useMisDatos } from '@/lib/portal';

const fecha = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};
const telefonoApi = (t: string) => t.replace(/[\s()-]/g, '');

/**
 * "Mis datos" del diseño. C-9: desde el portal el paciente cambia solo su
 * telefono y su correo (el correo nuevo se confirma con el enlace que le
 * llega). Nombre, fecha de nacimiento, contacto de emergencia y adulto
 * responsable los corrige el centro. El adulto responsable solo los ve.
 */
export function MisDatos() {
  const portal = usePortal();
  const consulta = useMisDatos(portal.pacienteParam, !portal.cargando && !!portal.pacienteId);
  const cliente = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [errores, setErrores] = useState<{ telefono?: string; correo?: string }>({});
  const [pendiente, setPendiente] = useState<string | null>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const editable = !portal.responsable;

  const guardar = useMutation({
    mutationFn: (cuerpo: { telefono?: string; email?: string }) => datos(api.PATCH('/api/portal/mis-datos', { body: cuerpo })),
    onSuccess: (r) => {
      setEditando(false);
      setPendiente(r.correoPendienteHasta);
      void cliente.invalidateQueries({ queryKey: clavesPortal.misDatos(portal.pacienteParam) });
    },
  });
  useEffect(() => {
    if (guardar.error) alerta.current?.focus();
  }, [guardar.error]);

  const empezar = () => {
    setTelefono(consulta.data?.telefono ? formatoTelefono(consulta.data.telefono) : '');
    setCorreo(consulta.data?.email ?? '');
    setErrores({});
    guardar.reset();
    setEditando(true);
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const d = consulta.data!;
    const nuevos: { telefono?: string; email?: string } = {};
    const err: typeof errores = {};
    const tel = telefonoApi(telefono);
    if (tel && tel !== d.telefono) {
      if (!/^\+56\d{9}$/.test(tel)) err.telefono = 'Escribe el teléfono con código de país: +56 9 1234 5678.';
      else nuevos.telefono = tel;
    }
    const mail = correo.trim().toLowerCase();
    if (mail && mail !== (d.email ?? '')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) err.correo = 'Revisa el correo: falta la @ o el dominio.';
      else nuevos.email = mail;
    }
    setErrores(err);
    if (err.telefono || err.correo) return;
    if (!nuevos.telefono && !nuevos.email) {
      setEditando(false);
      return;
    }
    guardar.mutate(nuevos);
  };

  return (
    <Panel
      titulo={portal.responsable ? `Datos de ${portal.paciente?.nombre ?? 'tu menor'}` : 'Mis datos'}
      accion={
        editable && consulta.data ? (
          <button
            type="button"
            onClick={() => (editando ? setEditando(false) : empezar())}
            className="flex min-h-10 cursor-pointer items-center gap-1.5 text-[13px] font-extrabold text-accent-2-700 hover:text-accent-2-800"
          >
            <Icon name={editando ? 'close' : 'edit'} size={16} />
            {editando ? 'Cancelar' : 'Editar'}
          </button>
        ) : undefined
      }
      bajada={
        editable
          ? 'Puedes corregir tu teléfono y tu correo cuando quieras. Para cambiar otros datos, pídelo en el centro.'
          : 'Estos datos los mantiene el centro. Si algo cambió, avísale a recepción o al profesional.'
      }
    >
      <EstadoConsulta consulta={consulta}>
        {(d) => (
          <form onSubmit={enviar} noValidate className="flex flex-col gap-3.5">
            {pendiente && (
              <Aviso tono="exito" role="status" icono="mark_email_read">
                Te enviamos un enlace al correo nuevo. Ábrelo antes del {formatoFechaHora(pendiente)} para confirmar el cambio; mientras tanto seguimos usando
                el anterior.
              </Aviso>
            )}
            <Dato etiqueta="Nombre completo">
              {d.nombre} {d.apellido}
            </Dato>
            <Dato etiqueta="Fecha de nacimiento">{fecha(d.fechaNacimiento)}</Dato>
            {editando ? (
              <>
                <Field label="Teléfono" error={errores.telefono} hint="Con código de país, por ejemplo +56 9 1234 5678.">
                  {(p) => <Input {...p} type="tel" autoComplete="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="!py-3" />}
                </Field>
                <Field label="Correo" error={errores.correo} hint="Si lo cambias, te enviaremos un enlace para confirmarlo.">
                  {(p) => <Input {...p} type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className="!py-3" />}
                </Field>
              </>
            ) : (
              <>
                <Dato etiqueta="Teléfono">{d.telefono ? formatoTelefono(d.telefono) : 'Sin teléfono registrado'}</Dato>
                <Dato etiqueta="Correo">{d.email ?? 'Sin correo registrado'}</Dato>
              </>
            )}
            <Dato etiqueta="Contacto de emergencia">{d.contactoEmergencia ?? 'Sin contacto registrado. Puedes dejarlo en tu próxima visita.'}</Dato>

            {d.adultosResponsables.length > 0 && (
              <div className="mt-2 border-t border-divider pt-5">
                <p className="m-0 mb-3.5 flex items-center gap-2 text-[13.5px] font-black tracking-[-0.015em]">
                  <Icon name="family_restroom" size={19} className="text-accent-700" />
                  {d.adultosResponsables.length > 1 ? 'Adultos responsables' : 'Adulto responsable'}
                </p>
                <div className="flex flex-col gap-3.5">
                  {d.adultosResponsables.map((a) => (
                    <div key={a.id} className="flex flex-col gap-3.5">
                      <Dato etiqueta="Nombre">{a.nombre}</Dato>
                      {a.parentesco && <Dato etiqueta="Relación">{a.parentesco}</Dato>}
                      {a.telefono && <Dato etiqueta="Teléfono de contacto">{formatoTelefono(a.telefono)}</Dato>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {guardar.error && (
              <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar tus datos. Intenta de nuevo.'}
              </p>
            )}
            {editando && (
              <Button type="submit" size="lg" loading={guardar.isPending} className="mt-1.5 w-full">
                Guardar mis datos
              </Button>
            )}
          </form>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-extrabold text-neutral-700">{etiqueta}</span>
      <span className="text-[15px] font-bold tracking-[-0.01em] break-words">{children}</span>
    </div>
  );
}
