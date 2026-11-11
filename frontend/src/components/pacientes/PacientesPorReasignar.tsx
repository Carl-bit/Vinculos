'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Paginador, usePaginacion } from '@/components/ui/Paginador';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { useEquipoAgenda } from '@/lib/panel';

type Fila = Awaited<ReturnType<typeof listar>>[number];
const listar = () => datos(api.GET('/api/bajas/por-reasignar'));

/**
 * Pacientes cuyo tratante dejo el centro o perdio el acceso (ADMIN/GESTION).
 * Correcciones 2026-11-11 (punto 33): vive solo en Fichas y Pacientes; antes
 * se repetia en Equipo > Alertas y bajas. Se reasignan con una derivacion de
 * oficio desde la ficha; nunca un cambio de rol.
 */
export function PacientesPorReasignar() {
  const porReasignar = useQuery({ queryKey: ['equipo', 'por-reasignar'], queryFn: listar });
  const directorio = useEquipoAgenda();
  const nombre = new Map((directorio.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  // Sin filas no ocupa espacio: es una bandeja que solo aparece cuando hay algo que hacer.
  if (porReasignar.isSuccess && porReasignar.data.length === 0) return null;
  return (
    <Panel titulo="Pacientes por reasignar" bajada="Su tratante dejó el centro o perdió el acceso. Se reasignan con una derivación de oficio desde la ficha.">
      <div className="mt-4">
        <EstadoConsulta consulta={porReasignar}>{(l) => <TablaReasignar filas={l} nombre={nombre} />}</EstadoConsulta>
      </div>
    </Panel>
  );
}

function TablaReasignar({ filas, nombre }: { filas: Fila[]; nombre: Map<string, string> }) {
  const paginas = usePaginacion(filas, 'pacientes-por-reasignar');
  return (
    <div className="flex flex-col gap-3">
      <Tabla etiqueta="Pacientes por reasignar">
        <thead>
          <tr>
            <Th>Paciente</Th>
            <Th>Tratante anterior</Th>
            <Th>Motivo</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {paginas.visibles.map((p) => (
            <tr key={p.paciente_id}>
              <Td className="font-extrabold">
                {p.nombre ? (
                  <Link href={`/admin/fichas/${p.paciente_id}`} className="text-text hover:text-accent-700">
                    {p.nombre} {p.apellido}
                  </Link>
                ) : (
                  p.codigo
                )}
              </Td>
              <Td className="font-semibold">{nombre.get(p.tratante_id) ?? 'Profesional'}</Td>
              <Td className="font-semibold text-neutral-800">{p.motivo}</Td>
              <Td>
                <Badge tono={p.derivacion_abierta ? 'positivo' : 'atencion'}>{p.derivacion_abierta ? 'Derivación en curso' : 'Sin derivar'}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabla>
      <Paginador {...paginas} etiqueta="pacientes" />
    </div>
  );
}
