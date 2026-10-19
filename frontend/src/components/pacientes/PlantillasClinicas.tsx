'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { useEspecialidades, useEspecialidadesDe } from '@/lib/equipo';
import { ESTADO_PLANTILLA, TIPO_PLANTILLA, usePlantillas, type PlantillaClinica, type TipoPlantilla } from '@/lib/fichas';
import { formatoFecha } from '@/lib/formato';
import type { Rol } from '@/lib/sesion';

import { EditorPlantilla } from './EditorPlantilla';

type Accion = { tipo: 'publicar' | 'desactivar'; plantilla: PlantillaClinica };

/**
 * Plantillas clinicas por especialidad (03a-2). Cada familia es una
 * plantilla con sus versiones: el borrador se edita; publicar (ADMIN) lo deja
 * inmutable y deja inactiva la version anterior; para cambiar una publicada se
 * crea una version nueva. Los registros guardan la version con que se
 * escribieron, asi que nada de lo ya escrito cambia.
 */
export function PlantillasClinicas({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const especialidades = useEspecialidades();
  const mias = useEspecialidadesDe(rol === 'PROFESIONAL' ? cuenta.data?.id : undefined);
  const [especialidadId, setEspecialidad] = useState('');
  const [tipo, setTipo] = useState<TipoPlantilla | ''>('');
  const plantillas = usePlantillas({ especialidadId: especialidadId || undefined, tipo: tipo || undefined });
  const [editor, setEditor] = useState<{ plantilla?: PlantillaClinica } | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [error, setError] = useState<string>();

  const nombreEsp = new Map((especialidades.data ?? []).map((e) => [e.id, e.nombre]));
  const aprobadas = new Set((mias.data ?? []).filter((e) => e.estado === 'APROBADO').map((e) => e.especialidadId));
  // Proponen ADMIN (cualquier especialidad activa) y el profesional en sus especialidades aprobadas.
  const paraProponer = (especialidades.data ?? []).filter((e) => e.activo && (admin || aprobadas.has(e.id)));
  const puedeProponer = (admin || rol === 'PROFESIONAL') && paraProponer.length > 0;

  const refrescar = () => void cliente.invalidateQueries({ queryKey: ['plantillas-clinicas'] });
  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos completar la acción.');
  const version = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/plantillas-clinicas/{id}/versiones', { params: { path: { id } } })),
    onSuccess: (p) => {
      refrescar();
      setEditor({ plantilla: p });
    },
    onError: fallo,
  });
  const ejecutar = useMutation({
    mutationFn: ({ tipo: t, plantilla }: Accion) =>
      t === 'publicar'
        ? datos(api.POST('/api/plantillas-clinicas/{id}/publicacion', { params: { path: { id: plantilla.id } } }))
        : datos(api.POST('/api/plantillas-clinicas/{id}/desactivacion', { params: { path: { id: plantilla.id } } })),
    onSuccess: () => {
      setAccion(null);
      refrescar();
    },
  });

  if (editor)
    return (
      <section aria-label="Editor de plantilla" className="entrada">
        <h2 className="m-0 mb-1 text-[20px] font-black tracking-[-0.01em]">{editor.plantilla ? `Editar ${editor.plantilla.nombre}` : 'Proponer plantilla'}</h2>
        <p className="m-0 mb-5 text-[13.5px] font-semibold text-neutral-800">
          {admin ? 'Queda en borrador hasta que la publiques.' : 'Queda en borrador: administración la revisa y la publica.'}
        </p>
        <EditorPlantilla
          plantilla={editor.plantilla}
          especialidades={editor.plantilla ? (especialidades.data ?? []) : paraProponer}
          onListo={() => setEditor(null)}
        />
      </section>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="w-[220px]">
            <Field label="Especialidad">
              {(p) => (
                <Select {...p} value={especialidadId} onChange={(e) => setEspecialidad(e.target.value)} className="!py-2.5">
                  <option value="">Todas</option>
                  {(especialidades.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="w-[200px]">
            <Field label="Uso">
              {(p) => (
                <Select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as TipoPlantilla | '')} className="!py-2.5">
                  <option value="">Ingreso y evolución</option>
                  <option value="INGRESO">{TIPO_PLANTILLA.INGRESO}</option>
                  <option value="EVOLUCION">{TIPO_PLANTILLA.EVOLUCION}</option>
                </Select>
              )}
            </Field>
          </div>
        </div>
        {puedeProponer && (
          <Button variant="team" icon="add" onClick={() => setEditor({})}>
            Proponer plantilla
          </Button>
        )}
      </div>
      {rol === 'PROFESIONAL' && !puedeProponer && mias.isSuccess && (
        <Aviso tono="nota" icono="workspace_premium">
          Para proponer plantillas necesitas una especialidad aprobada (Mi perfil › Especialidades).
        </Aviso>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <EstadoConsulta consulta={plantillas} vacio={(l) => l.length === 0} textoVacio="No hay plantillas con estos filtros">
        {(lista) => {
          const familias = new Map<string, PlantillaClinica[]>();
          for (const p of lista) familias.set(p.familiaId, [...(familias.get(p.familiaId) ?? []), p]);
          return (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {[...familias.values()].map((versiones) => {
                const orden = [...versiones].sort((a, b) => b.version - a.version);
                const publicada = orden.find((v) => v.estado === 'PUBLICADA');
                const borrador = orden.find((v) => v.estado === 'BORRADOR');
                const cabeza = publicada ?? borrador ?? orden[0];
                return (
                  <li key={cabeza.familiaId} className="rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[15px] font-black">{cabeza.nombre}</p>
                        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                          {TIPO_PLANTILLA[cabeza.tipo]} · {nombreEsp.get(cabeza.especialidadId) ?? 'Especialidad'} · {cabeza.definicion.length}{' '}
                          {cabeza.definicion.length === 1 ? 'campo' : 'campos'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {borrador && (
                          <Button variant="secondary" icon="edit" onClick={() => setEditor({ plantilla: borrador })} className="!px-4 !py-2 !text-[13px]">
                            Editar borrador
                          </Button>
                        )}
                        {publicada && !borrador && (admin || aprobadas.has(publicada.especialidadId)) && (
                          <Button
                            variant="secondary"
                            icon="edit_note"
                            loading={version.isPending && version.variables === publicada.id}
                            onClick={() => version.mutate(publicada.id)}
                            className="!px-4 !py-2 !text-[13px]"
                          >
                            Nueva versión
                          </Button>
                        )}
                        {admin && borrador && (
                          <Button
                            variant="team"
                            icon="task_alt"
                            onClick={() => setAccion({ tipo: 'publicar', plantilla: borrador })}
                            className="!px-4 !py-2 !text-[13px]"
                          >
                            Publicar v{borrador.version}
                          </Button>
                        )}
                        {admin && publicada && (
                          <Button variant="ghost" onClick={() => setAccion({ tipo: 'desactivar', plantilla: publicada })} className="!px-4 !py-2 !text-[13px]">
                            Desactivar
                          </Button>
                        )}
                      </div>
                    </div>
                    <details className="mt-3 border-t border-divider pt-2.5">
                      <summary className="min-h-10 cursor-pointer py-2 text-[13px] font-extrabold text-accent-700">
                        Historial de versiones ({orden.length})
                      </summary>
                      <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
                        {orden.map((v) => (
                          <li key={v.id} className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-neutral-800">
                            <span className="w-[86px] font-extrabold">Versión {v.version}</span>
                            <Badge tono={ESTADO_PLANTILLA[v.estado].tono}>{ESTADO_PLANTILLA[v.estado].texto}</Badge>
                            {v.publicadaEn && <span className="text-neutral-700">publicada el {formatoFecha(v.publicadaEn)}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </EstadoConsulta>

      <Modal
        abierto={!!accion}
        onCerrar={() => setAccion(null)}
        titulo={
          accion?.tipo === 'publicar' ? `Publicar ${accion.plantilla.nombre} v${accion.plantilla.version}` : `Desactivar ${accion?.plantilla.nombre ?? ''}`
        }
        descripcion={
          accion?.tipo === 'publicar'
            ? 'Desde ahora el equipo la usa en registros nuevos y ya no se edita (los cambios van en una versión nueva). La versión publicada anterior queda inactiva; lo ya escrito conserva su versión.'
            : 'Deja de ofrecerse en registros nuevos. Lo ya escrito con ella se sigue leyendo igual.'
        }
        acciones={
          <>
            <Button variant="ghost" onClick={() => setAccion(null)}>
              Volver
            </Button>
            <Button variant="team" loading={ejecutar.isPending} onClick={() => accion && ejecutar.mutate(accion)}>
              {accion?.tipo === 'publicar' ? 'Publicar' : 'Desactivar'}
            </Button>
          </>
        }
      >
        {ejecutar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {ejecutar.error instanceof ApiError ? ejecutar.error.message : 'No pudimos completar la acción.'}
          </p>
        )}
      </Modal>
    </div>
  );
}
