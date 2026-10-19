'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta, useProfesionales } from '@/lib/consultas';
import { useEstadosAvance, useIntervenciones, useTiposDocumento, useTiposSesion, type CatalogoClinico, type TipoDocumento } from '@/lib/fichas';
import type { Rol } from '@/lib/sesion';

const textoError = (e: unknown, base: string) => (e instanceof ApiError ? e.message : base);

/**
 * Catalogos clinicos (B). Tipos de sesion: el equipo clinico propone y solo
 * administracion aprueba o rechaza; intervenciones, estados de avance y tipos
 * de documento los mantiene administracion. Nada se borra: se desactiva y
 * sigue leyendose en los registros antiguos.
 */
export function CatalogosClinicos({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  return (
    <div className="flex flex-col gap-4">
      <TiposSesion admin={admin} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <CatalogoSimple titulo="Intervenciones" ruta="/api/intervenciones" admin={admin} consulta={useIntervenciones()} clave="intervenciones" />
        <CatalogoSimple titulo="Estados de avance" ruta="/api/estados-avance" admin={admin} consulta={useEstadosAvance()} clave="estados-avance" />
      </div>
      <TiposDocumento admin={admin} />
    </div>
  );
}

function TiposSesion({ admin }: { admin: boolean }) {
  const cliente = useQueryClient();
  const tipos = useTiposSesion();
  const cuenta = useMiCuenta();
  const equipo = useProfesionales(admin);
  const nombre = new Map((equipo.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '' });
  const [aviso, setAviso] = useState<string>();
  const refrescar = () => void cliente.invalidateQueries({ queryKey: ['catalogos', 'tipos-sesion'] });
  const proponer = useMutation({
    mutationFn: () => datos(api.POST('/api/tipos-sesion', { body: { nombre: nuevo.nombre.trim(), descripcion: nuevo.descripcion.trim() || undefined } })),
    onSuccess: (t) => {
      setNuevo({ nombre: '', descripcion: '' });
      setAviso(admin ? `"${t.nombre}" quedó por revisar: apruébalo para usarlo.` : `Propusiste "${t.nombre}". Administración lo revisa.`);
      refrescar();
    },
  });
  const revisar = useMutation({
    mutationFn: ({ id, ...body }: { id: string; estado?: 'APROBADO' | 'RECHAZADO'; activo?: boolean }) =>
      datos(api.PATCH('/api/tipos-sesion/{id}', { params: { path: { id } }, body })),
    onSuccess: refrescar,
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setAviso(undefined);
    if (nuevo.nombre.trim().length >= 2) proponer.mutate();
  };
  return (
    <Panel
      titulo="Tipos de sesión"
      bajada={
        admin
          ? 'Los propone el equipo clínico. Solo los aprobados y activos se usan al confirmar una evolución.'
          : 'Si falta uno, propónlo: se usa cuando administración lo apruebe.'
      }
    >
      <div className="mt-4 flex flex-col gap-4">
        <EstadoConsulta consulta={tipos} vacio={(l) => l.length === 0} textoVacio="Catálogo vacío">
          {(lista) => {
            const visibles = admin ? lista : lista.filter((t) => t.estado === 'APROBADO' || t.propuestoPorId === cuenta.data?.id);
            const porRevisar = visibles.filter((t) => t.estado === 'PROPUESTO');
            const resto = visibles.filter((t) => t.estado !== 'PROPUESTO');
            return (
              <>
                {porRevisar.length > 0 && (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Por revisar">
                    {porRevisar.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-500 bg-accent-100 px-4 py-3">
                        <div className="min-w-0">
                          <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
                            {t.nombre} <Badge tono="atencion">Por revisar</Badge>
                          </p>
                          {t.descripcion && <p className="m-0 text-[13px] font-semibold text-neutral-800">{t.descripcion}</p>}
                          {admin && <p className="m-0 text-xs font-semibold text-neutral-700">Propuesto por {nombre.get(t.propuestoPorId) ?? 'el equipo'}</p>}
                        </div>
                        {admin && (
                          <div className="flex gap-2">
                            <Button variant="ghost" onClick={() => revisar.mutate({ id: t.id, estado: 'RECHAZADO' })} className="!px-4 !py-2 !text-[13px]">
                              Rechazar
                            </Button>
                            <Button
                              variant="team"
                              icon="check"
                              onClick={() => revisar.mutate({ id: t.id, estado: 'APROBADO' })}
                              className="!px-4 !py-2 !text-[13px]"
                            >
                              Aprobar
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {resto.map((t) => {
                    const rechazado = t.estado === 'RECHAZADO';
                    const activo = t.activo && !rechazado;
                    return (
                      <li
                        key={t.id}
                        className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-3.5 text-[13px] font-bold ${admin && !rechazado ? 'pr-1' : 'pr-3.5'} ${activo ? 'border-accent-2-500 bg-accent-2-200' : 'border-divider bg-neutral-100 text-neutral-700'}`}
                      >
                        {t.nombre}
                        {rechazado && <span className="text-[11.5px] font-extrabold">(rechazado)</span>}
                        {admin && !rechazado && (
                          <button
                            type="button"
                            onClick={() => revisar.mutate({ id: t.id, activo: !t.activo })}
                            className="min-h-8 cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
                            aria-label={`${t.activo ? 'Desactivar' : 'Activar'} ${t.nombre}`}
                          >
                            {t.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            );
          }}
        </EstadoConsulta>
        {revisar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {textoError(revisar.error, 'No pudimos guardar la revisión.')}
          </p>
        )}
        <form onSubmit={enviar} noValidate className="flex flex-col gap-3 border-t border-divider pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Field label={admin ? 'Agregar tipo de sesión' : 'Proponer tipo de sesión'}>
              {(p) => <Input {...p} maxLength={80} value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="!py-2.5" />}
            </Field>
            <Field label="Descripción (opcional)">
              {(p) => (
                <Input
                  {...p}
                  maxLength={500}
                  value={nuevo.descripcion}
                  onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
                  className="!py-2.5"
                />
              )}
            </Field>
          </div>
          {aviso && (
            <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
              {aviso}
            </p>
          )}
          {proponer.error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {textoError(proponer.error, 'No pudimos registrar la propuesta.')}
            </p>
          )}
          <div>
            <Button type="submit" variant="secondary" icon="add" disabled={nuevo.nombre.trim().length < 2} loading={proponer.isPending} className="!py-2.5">
              {admin ? 'Agregar' : 'Proponer'}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function CatalogoSimple({
  titulo,
  ruta,
  admin,
  consulta,
  clave,
}: {
  titulo: string;
  ruta: '/api/intervenciones' | '/api/estados-avance';
  admin: boolean;
  consulta: ReturnType<typeof useIntervenciones>;
  clave: string;
}) {
  const cliente = useQueryClient();
  const [nuevo, setNuevo] = useState('');
  const refrescar = () => void cliente.invalidateQueries({ queryKey: ['catalogos', clave] });
  const crear = useMutation({
    mutationFn: () =>
      ruta === '/api/intervenciones'
        ? datos(api.POST('/api/intervenciones', { body: { nombre: nuevo.trim() } }))
        : datos(api.POST('/api/estados-avance', { body: { nombre: nuevo.trim() } })),
    onSuccess: () => {
      setNuevo('');
      refrescar();
    },
  });
  const activar = useMutation({
    mutationFn: (x: CatalogoClinico) =>
      ruta === '/api/intervenciones'
        ? datos(api.PATCH('/api/intervenciones/{id}', { params: { path: { id: x.id } }, body: { activo: !x.activo } }))
        : datos(api.PATCH('/api/estados-avance/{id}', { params: { path: { id: x.id } }, body: { activo: !x.activo } })),
    onSuccess: refrescar,
  });
  const error = crear.error ?? activar.error;
  return (
    <Panel titulo={titulo} bajada={admin ? 'Los mantiene administración. Desactivar no borra los registros antiguos.' : 'Los mantiene administración.'}>
      <div className="mt-4 flex flex-col gap-3">
        <EstadoConsulta consulta={consulta} vacio={(l) => l.length === 0} textoVacio="Catálogo vacío">
          {(l) => (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {l
                .filter((x) => admin || x.activo)
                .map((x) => (
                  <li
                    key={x.id}
                    className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-3.5 text-[13px] font-bold ${admin ? 'pr-1' : 'pr-3.5'} ${x.activo ? 'border-accent-2-500 bg-accent-2-200' : 'border-divider bg-neutral-100 text-neutral-700'}`}
                  >
                    {x.nombre}
                    {admin && (
                      <button
                        type="button"
                        onClick={() => activar.mutate(x)}
                        className="min-h-8 cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
                        aria-label={`${x.activo ? 'Desactivar' : 'Activar'} ${x.nombre}`}
                      >
                        {x.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </EstadoConsulta>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {textoError(error, 'No pudimos guardar el cambio.')}
          </p>
        )}
        {admin && (
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={`Nuevo en ${titulo}`}
              placeholder="Agregar al catálogo"
              value={nuevo}
              maxLength={80}
              onChange={(e) => setNuevo(e.target.value)}
              className="!max-w-[280px] !py-2"
            />
            <Button
              variant="secondary"
              icon="add"
              disabled={nuevo.trim().length < 2}
              loading={crear.isPending}
              onClick={() => crear.mutate()}
              className="!py-2.5"
            >
              Agregar
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

const VARIABLES_DOCUMENTO = ['{{nombre_paciente}}', '{{nombre_profesional}}', '{{fecha}}', '{{nombre_centro}}', '{{contenido}}'] as const;

/** Tipos de documento clinico: formato con variables permitidas (otra variable -> 422 de la BD). */
function TiposDocumento({ admin }: { admin: boolean }) {
  const tipos = useTiposDocumento();
  const [editar, setEditar] = useState<TipoDocumento | 'nuevo' | null>(null);
  return (
    <>
      <Panel
        titulo="Tipos de documento"
        bajada="Certificados, informes y epicrisis que emite el tratante. El formato arma el PDF con estas variables."
        accion={
          admin && (
            <Button variant="secondary" icon="add" onClick={() => setEditar('nuevo')} className="!py-2.5">
              Nuevo tipo
            </Button>
          )
        }
      >
        <div className="mt-4">
          <EstadoConsulta consulta={tipos} vacio={(l) => l.length === 0} textoVacio="Sin tipos de documento">
            {(lista) => (
              <ul className="m-0 flex list-none flex-col p-0">
                {lista
                  .filter((t) => admin || t.activo)
                  .map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                      <div className="min-w-0">
                        <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
                          {t.nombre}
                          {!t.activo && <Badge tono="neutro">Inactivo</Badge>}
                        </p>
                        <p className="m-0 line-clamp-1 font-mono text-[12.5px] text-neutral-700">{t.plantilla}</p>
                      </div>
                      {admin && (
                        <Button variant="ghost" icon="edit" onClick={() => setEditar(t)} className="!px-3.5 !py-2 !text-[13px]">
                          Editar
                        </Button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
      <Modal
        abierto={!!editar}
        onCerrar={() => setEditar(null)}
        titulo={editar === 'nuevo' ? 'Nuevo tipo de documento' : 'Editar tipo de documento'}
        ancho="lg"
      >
        {editar && <FormularioTipoDocumento tipo={editar === 'nuevo' ? undefined : editar} onListo={() => setEditar(null)} />}
      </Modal>
    </>
  );
}

function FormularioTipoDocumento({ tipo, onListo }: { tipo?: TipoDocumento; onListo: () => void }) {
  const cliente = useQueryClient();
  const [nombre, setNombre] = useState(tipo?.nombre ?? '');
  const [plantilla, setPlantilla] = useState(tipo?.plantilla ?? '{{contenido}}');
  const [activo, setActivo] = useState(tipo?.activo ?? true);
  const guardar = useMutation({
    mutationFn: () =>
      tipo
        ? datos(api.PATCH('/api/tipos-documento-clinico/{id}', { params: { path: { id: tipo.id } }, body: { nombre: nombre.trim(), plantilla, activo } }))
        : datos(api.POST('/api/tipos-documento-clinico', { body: { nombre: nombre.trim(), plantilla } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['catalogos', 'tipos-documento'] });
      onListo();
    },
  });
  const sinContenido = !plantilla.includes('{{contenido}}');
  return (
    <div className="flex flex-col gap-4">
      <Field label="Nombre" required>
        {(p) => <Input {...p} maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} />}
      </Field>
      <Field
        label="Formato del documento"
        required
        hint={`Variables permitidas: ${VARIABLES_DOCUMENTO.join(', ')}. {{contenido}} es lo que redacta el profesional.`}
        error={sinContenido ? 'Incluye {{contenido}}: si no, el texto del profesional no aparece en el documento.' : undefined}
      >
        {(p) => <Textarea {...p} rows={8} value={plantilla} onChange={(e) => setPlantilla(e.target.value)} className="!min-h-44 font-mono !text-[13.5px]" />}
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {VARIABLES_DOCUMENTO.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setPlantilla((t) => `${t}${t.endsWith('\n') || !t ? '' : ' '}${v}`)}
            className="min-h-8 cursor-pointer rounded-full border border-divider bg-neutral-100 px-3 font-mono text-[12px] font-bold hover:border-accent-500 hover:bg-accent-200"
          >
            {v}
          </button>
        ))}
      </div>
      {tipo && (
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13.5px] font-bold">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-[18px] accent-accent-700" />
          Activo (se ofrece al emitir documentos)
        </label>
      )}
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(guardar.error, 'No pudimos guardar el tipo de documento.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" icon="save" disabled={nombre.trim().length < 2 || sinContenido} loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar
        </Button>
      </div>
    </div>
  );
}
