'use client';

import { useQuery } from '@tanstack/react-query';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import { hoyChile, nombresPacientes, useCitas, useEquipoAgenda, usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

/**
 * Pestaña Pendientes: horas por aprobar (pacientes nuevos de profesionales que
 * aprueban antes) y citas por reprogramar (salida, revocacion o baja del
 * profesional). Cada fila abre el detalle de la sesion.
 */
export function PendientesAgenda({ rol, onElegir }: { rol: Rol; onElegir: (c: CitaVista) => void }) {
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const filtro = admin ? (profesionalId ?? undefined) : undefined;
  const porAprobar = useCitas({ estado: 'SOLICITADA', desde: hoyChile().desde, profesionalId: filtro });
  const porReprogramar = useQuery({ queryKey: ['panel', 'citas', 'por-reprogramar'], queryFn: () => datos(api.GET('/api/citas/por-reprogramar')) });
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));

  const lista = (citas: CitaVista[], tono: 'atencion' | 'neutro', texto: string) => (
    <Tabla etiqueta={texto}>
      <thead>
        <tr>
          <Th>Paciente</Th>
          <Th>Profesional</Th>
          <Th>Fecha</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {citas.map((c) => (
          <tr key={c.id} className="cursor-pointer transition-colors duration-200 hover:bg-accent-100" onClick={() => onElegir(c)}>
            <Td>
              <button type="button" onClick={() => onElegir(c)} className="cursor-pointer text-left text-[14.5px] font-extrabold hover:text-accent-700">
                {nombres.get(c.pacienteId) ?? 'Paciente'}
              </button>
            </Td>
            <Td className="font-semibold">{profesional.get(c.profesionalId) ?? 'Profesional'}</Td>
            <Td className="font-semibold text-neutral-800 first-letter:uppercase">
              {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)}
            </Td>
            <Td>
              <Badge tono={tono}>{texto}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );

  return (
    <div className="flex flex-col gap-5">
      <Panel titulo="Por aprobar" bajada="Pacientes nuevos: la hora queda retenida hasta que el profesional (o administración) la apruebe.">
        <div className="mt-4">
          <EstadoConsulta consulta={porAprobar} vacio={(l) => l.length === 0} textoVacio="No hay horas por aprobar">
            {(l) => lista(l, 'atencion', 'Por confirmar')}
          </EstadoConsulta>
        </div>
      </Panel>
      <Panel titulo="Por reprogramar" bajada="El profesional ya no puede atender esas horas. Reprograma con el tratante o cubre la sesión.">
        <div className="mt-4">
          <EstadoConsulta
            consulta={porReprogramar}
            vacio={(l) => l.filter((c) => !filtro || c.profesionalId === filtro).length === 0}
            textoVacio="No hay citas por reprogramar"
          >
            {(l) =>
              lista(
                l.filter((c) => !filtro || c.profesionalId === filtro),
                'neutro',
                'Por reprogramar',
              )
            }
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}
