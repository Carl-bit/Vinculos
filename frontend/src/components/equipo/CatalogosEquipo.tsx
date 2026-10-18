'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useProfesionales } from '@/lib/consultas';
import { useEspecialidades } from '@/lib/equipo';
import { useTiposAtencion } from '@/lib/panel';

/**
 * Catalogos del equipo (solo ADMIN): tipos de atencion y especialidades. No
 * se borran: se desactivan (quedan en registros antiguos). Las propuestas
 * pendientes de tipos de atencion se revisan aca o en la ficha de cada uno.
 */
export function CatalogosEquipo() {
  const cliente = useQueryClient();
  const tipos = useTiposAtencion();
  const especialidades = useEspecialidades();
  const propuestas = useQuery({ queryKey: ['equipo', 'propuestas'], queryFn: () => datos(api.GET('/api/tipos-atencion/propuestas')) });
  const profesionales = useProfesionales(true);
  const nombrePro = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const nombreTipo = new Map((tipos.data ?? []).map((t) => [t.id, t.nombre]));
  const [nuevoTipo, setNuevoTipo] = useState('');
  const [nuevaEsp, setNuevaEsp] = useState('');
  const [error, setError] = useState<string>();
  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el cambio.');
  const refrescar = () => {
    setError(undefined);
    void cliente.invalidateQueries({ queryKey: ['panel', 'tipos-atencion'] });
    void cliente.invalidateQueries({ queryKey: ['equipo'] });
  };
  const crearTipo = useMutation({
    mutationFn: () => datos(api.POST('/api/tipos-atencion', { body: { nombre: nuevoTipo.trim() } })),
    onSuccess: () => {
      setNuevoTipo('');
      refrescar();
    },
    onError: fallo,
  });
  const activarTipo = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      datos(api.PATCH('/api/tipos-atencion/{id}', { params: { path: { id } }, body: { activo } })),
    onSuccess: refrescar,
    onError: fallo,
  });
  const crearEsp = useMutation({
    mutationFn: () => datos(api.POST('/api/especialidades', { body: { nombre: nuevaEsp.trim() } })),
    onSuccess: () => {
      setNuevaEsp('');
      refrescar();
    },
    onError: fallo,
  });
  const activarEsp = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      datos(api.PATCH('/api/especialidades/{id}', { params: { path: { id } }, body: { activo } })),
    onSuccess: refrescar,
    onError: fallo,
  });
  const revisar = useMutation({
    mutationFn: ({ profesionalId, tipoAtencionId, estado }: { profesionalId: string; tipoAtencionId: string; estado: 'APROBADO' | 'RECHAZADO' }) =>
      datos(
        api.PATCH('/api/profesionales/{id}/tipos-atencion/{tipoAtencionId}', { params: { path: { id: profesionalId, tipoAtencionId } }, body: { estado } }),
      ),
    onSuccess: refrescar,
    onError: fallo,
  });

  const catalogo = (
    titulo: string,
    bajada: string,
    consulta: typeof tipos | typeof especialidades,
    nuevo: string,
    setNuevo: (v: string) => void,
    crear: () => void,
    creando: boolean,
    activar: (id: string, activo: boolean) => void,
  ) => (
    <Panel titulo={titulo} bajada={bajada}>
      <div className="mt-4 flex flex-col gap-3">
        <EstadoConsulta consulta={consulta} vacio={(l) => l.length === 0} textoVacio="Catálogo vacío">
          {(l) => (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {l.map((x) => (
                <li
                  key={x.id}
                  className={`inline-flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-3.5 text-[13px] font-bold ${x.activo ? 'border-accent-2-500 bg-accent-2-200' : 'border-divider bg-neutral-100 text-neutral-700'}`}
                >
                  {x.nombre}
                  <button
                    type="button"
                    onClick={() => activar(x.id, !x.activo)}
                    className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
                    aria-label={`${x.activo ? 'Desactivar' : 'Activar'} ${x.nombre}`}
                  >
                    {x.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={`Nuevo en ${titulo}`}
            placeholder="Agregar al catálogo"
            value={nuevo}
            maxLength={80}
            onChange={(e) => setNuevo(e.target.value)}
            className="!max-w-[320px] !py-2"
          />
          <Button variant="secondary" icon="add" disabled={nuevo.trim().length < 2} loading={creando} onClick={crear} className="!py-2.5">
            Agregar
          </Button>
        </div>
      </div>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <Panel titulo="Tipos de atención por revisar" bajada="Propuestos por cada profesional. Solo los aprobados cuentan en el match y en el perfil público.">
        <div className="mt-4">
          <EstadoConsulta consulta={propuestas} vacio={(l) => l.length === 0} textoVacio="No hay propuestas pendientes">
            {(l) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {l.map((p) => (
                  <li
                    key={`${p.profesionalId}-${p.tipoAtencionId}`}
                    className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-divider bg-bg px-3.5 py-2"
                  >
                    <span className="min-w-0 flex-1 text-[14px] font-bold">
                      {nombrePro.get(p.profesionalId) ?? 'Profesional'} · {nombreTipo.get(p.tipoAtencionId) ?? 'Tipo de atención'}
                    </span>
                    <Badge tono="atencion">Por revisar</Badge>
                    <Button
                      variant="ghost"
                      icon="check"
                      onClick={() => revisar.mutate({ profesionalId: p.profesionalId, tipoAtencionId: p.tipoAtencionId, estado: 'APROBADO' })}
                      className="!px-3 !py-1.5 !text-[12.5px]"
                    >
                      Aprobar
                    </Button>
                    <Button
                      variant="ghost"
                      icon="close"
                      onClick={() => revisar.mutate({ profesionalId: p.profesionalId, tipoAtencionId: p.tipoAtencionId, estado: 'RECHAZADO' })}
                      className="!px-3 !py-1.5 !text-[12.5px]"
                    >
                      Rechazar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        {catalogo(
          'Tipos de atención',
          'Adultos, parejas, infanto-juvenil… Ordenan el match y el directorio.',
          tipos,
          nuevoTipo,
          setNuevoTipo,
          () => crearTipo.mutate(),
          crearTipo.isPending,
          (id, activo) => activarTipo.mutate({ id, activo }),
        )}
        {catalogo(
          'Especialidades',
          'Definen qué plantillas clínicas puede usar cada profesional.',
          especialidades,
          nuevaEsp,
          setNuevaEsp,
          () => crearEsp.mutate(),
          crearEsp.isPending,
          (id, activo) => activarEsp.mutate({ id, activo }),
        )}
      </div>
    </div>
  );
}
