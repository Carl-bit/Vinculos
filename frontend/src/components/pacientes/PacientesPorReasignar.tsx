'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Paginador, usePaginacion } from '@/components/ui/Paginador';
import { Panel } from '@/components/ui/Panel';
import { BarraSeleccion, CasillaFila, useSeleccion } from '@/components/ui/Seleccion';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { useEquipoAgenda } from '@/lib/panel';

import { CrearDerivacion } from './CrearDerivacion';

type Fila = Awaited<ReturnType<typeof listar>>[number];

/** motivo_reasignacion() de la BD, en palabras. */
const MOTIVO: Record<string, string> = {
  BAJA: 'Su profesional deja el centro',
  ACCESO_EXPIRADO: 'Terminó la práctica de su tratante',
  ACCESO_REVOCADO: 'Se revocó el acceso de su tratante',
  SIN_SUPERVISION: 'Su practicante quedó sin supervisor',
  CONSENTIMIENTO: 'Sin consentimiento para el practicante',
  TRATANTE_INACTIVO: 'Su tratante está inactivo',
  NO_ATIENDE: 'Su profesional no atenderá más',
  ATENCION_TEMPORAL: 'Pidió atención temporal (su profesional está ausente)',
};
const listar = () => datos(api.GET('/api/bajas/por-reasignar'));

/**
 * Pacientes cuyo tratante dejo el centro o perdio el acceso (punto 33). Vive
 * en Fichas y Pacientes > Derivaciones de la cuenta madre (la reasignacion es
 * una derivacion de oficio). Punto 20: solo el nombre, sin abrir el perfil.
 * Punto 24: seleccion multiple y "Derivar" para el grupo.
 */
export function PacientesPorReasignar() {
  const porReasignar = useQuery({ queryKey: ['equipo', 'por-reasignar'], queryFn: listar });
  const directorio = useEquipoAgenda();
  const nombre = new Map((directorio.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  return (
    <Panel
      titulo="Pacientes por reasignar"
      bajada="Su tratante dejó el centro o no atiende. Elige uno o varios y derívalos de oficio: se ofrecen a los candidatos en orden."
    >
      <div className="mt-4">
        <EstadoConsulta consulta={porReasignar} vacio={(l) => l.length === 0} textoVacio="No hay pacientes por reasignar">
          {(l) => <TablaReasignar filas={l} nombre={nombre} />}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}

function TablaReasignar({ filas, nombre }: { filas: Fila[]; nombre: Map<string, string> }) {
  const paginas = usePaginacion(filas, 'pacientes-por-reasignar');
  const seleccion = useSeleccion();
  const [derivar, setDerivar] = useState<Fila[] | null>(null);
  const libres = paginas.visibles.filter((p) => !p.derivacion_abierta).map((p) => p.paciente_id);
  const marcadas = libres.filter((id) => seleccion.ids.has(id)).length;
  const elegidos = filas.filter((p) => seleccion.ids.has(p.paciente_id));
  const derivable = (p: Fila) => ({ id: p.paciente_id, nombre: p.nombre ?? p.codigo, apellido: p.nombre ? (p.apellido ?? '') : '' });
  return (
    <div className="flex flex-col gap-3">
      <BarraSeleccion cantidad={seleccion.ids.size} onLimpiar={seleccion.limpiar}>
        <Button variant="team" icon="call_split" onClick={() => setDerivar(elegidos)} className="!px-4 !py-2 !text-[13px]">
          Derivar seleccionados
        </Button>
      </BarraSeleccion>
      <Tabla etiqueta="Pacientes por reasignar">
        <thead>
          <tr>
            <Th className="w-10">
              <CasillaFila
                etiqueta="Seleccionar los de esta página"
                marcada={libres.length > 0 && marcadas === libres.length}
                intermedia={marcadas > 0 && marcadas < libres.length}
                deshabilitada={libres.length === 0}
                onChange={(v) => seleccion.marcarPagina(libres, v)}
              />
            </Th>
            <Th>Paciente</Th>
            <Th>Tratante anterior</Th>
            <Th>Motivo</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {paginas.visibles.map((p) => {
            const nombrePaciente = p.nombre ? `${p.nombre} ${p.apellido}` : p.codigo;
            return (
              <tr key={p.paciente_id} className={seleccion.ids.has(p.paciente_id) ? 'bg-accent-2-100' : ''}>
                <Td>
                  <CasillaFila
                    etiqueta={`Seleccionar a ${nombrePaciente}`}
                    marcada={seleccion.ids.has(p.paciente_id)}
                    deshabilitada={p.derivacion_abierta}
                    onChange={() => seleccion.alternar(p.paciente_id)}
                  />
                </Td>
                <Td className="font-extrabold">{nombrePaciente}</Td>
                <Td className="font-semibold">{nombre.get(p.tratante_id) ?? 'Profesional'}</Td>
                <Td className="font-semibold text-neutral-800">{MOTIVO[p.motivo] ?? p.motivo}</Td>
                <Td>
                  {p.derivacion_abierta ? (
                    <Badge tono="positivo">Derivación en curso</Badge>
                  ) : (
                    <Button variant="secondary" icon="swap_horiz" onClick={() => setDerivar([p])} className="!px-3.5 !py-1.5 !text-[12.5px]">
                      Reasignar
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabla>
      <Paginador {...paginas} etiqueta="pacientes" />
      {derivar && (
        <CrearDerivacion
          varios={derivar.map(derivable)}
          abierto
          onCerrar={() => {
            setDerivar(null);
            seleccion.limpiar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Punto 9: pacientes en atencion temporal cuyo profesional principal ya esta
 * disponible (primero los que pidieron volver). "Ofrecer volver" es una
 * derivacion al principal (al aceptarla, la atencion temporal se cierra sola);
 * "Se queda" la cierra y sigue con su profesional actual. Sin filas no ocupa espacio.
 */
export function RetornosDisponibles() {
  const cliente = useQueryClient();
  const retornos = useQuery({ queryKey: ['panel', 'derivaciones', 'retornos'], queryFn: () => datos(api.GET('/api/derivaciones/retornos')) });
  const directorio = useEquipoAgenda();
  const nombre = new Map((directorio.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const [volver, setVolver] = useState<Retorno | null>(null);
  const mantener = useMutation({
    mutationFn: (pacienteId: string) => datos(api.POST('/api/derivaciones/retornos/{pacienteId}/mantener', { params: { path: { pacienteId } } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['panel', 'derivaciones', 'retornos'] }),
  });
  if (!retornos.data?.length) return null;
  return (
    <Panel titulo="Pueden volver con su profesional" bajada="Su profesional principal ya está disponible. Ofrécele volver o déjalo con quien lo atiende ahora.">
      <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
        {retornos.data.map((r) => (
          <li key={r.pacienteId} className="flex flex-wrap items-center gap-3 rounded-lg border border-divider bg-bg px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[14px] font-extrabold">
                {r.nombre} {r.apellido} {r.pideVolver && <Badge tono="atencion">Pidió volver</Badge>}
              </p>
              <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
                Principal: {nombre.get(r.profesionalPrincipalId) ?? 'Profesional'} · ahora con {nombre.get(r.tratanteActualId) ?? 'otro profesional'}
              </p>
            </div>
            <Button variant="team" icon="swap_horiz" onClick={() => setVolver(r)} className="!px-3.5 !py-1.5 !text-[12.5px]">
              Ofrecer volver
            </Button>
            <Button
              variant="ghost"
              loading={mantener.isPending && mantener.variables === r.pacienteId}
              onClick={() => mantener.mutate(r.pacienteId)}
              className="!px-3.5 !py-1.5 !text-[12.5px]"
            >
              Se queda
            </Button>
          </li>
        ))}
      </ul>
      {volver && (
        <CrearDerivacion
          varios={[{ id: volver.pacienteId, nombre: volver.nombre, apellido: volver.apellido }]}
          candidatosIniciales={[volver.profesionalPrincipalId]}
          nombresIniciales={{ [volver.profesionalPrincipalId]: nombre.get(volver.profesionalPrincipalId) ?? 'Profesional principal' }}
          motivoInicial="Vuelve con su profesional principal después de su ausencia."
          abierto
          onCerrar={() => {
            setVolver(null);
            void cliente.invalidateQueries({ queryKey: ['panel', 'derivaciones', 'retornos'] });
          }}
        />
      )}
    </Panel>
  );
}

type Retorno = components['schemas']['RetornoDisponible'];
