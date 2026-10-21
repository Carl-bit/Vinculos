'use client';

import { useQuery } from '@tanstack/react-query';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { formatoFechaHora, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { hoyChile, nombreDeCita, nombresPacientes, useCitas, useEquipoAgenda, usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

/**
 * Pestaña Pendientes: horas con pago pendiente (03b-3.2: se confirman con el
 * pago; si vence el plazo, se pagan en el centro) y citas por reprogramar (salida,
 * revocacion o baja del profesional). Cada fila abre el detalle de la sesion.
 */
export function PendientesAgenda({ rol, onElegir }: { rol: Rol; onElegir: (c: CitaVista) => void }) {
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const filtro = admin ? (profesionalId ?? undefined) : undefined;
  const porPagar = useCitas({ estado: 'PENDIENTE_PAGO', desde: hoyChile().desde, profesionalId: filtro });
  const porReprogramar = useQuery({ queryKey: ['panel', 'citas', 'por-reprogramar'], queryFn: () => datos(api.GET('/api/citas/por-reprogramar')) });
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));

  const lista = (citas: CitaVista[], tono: 'atencion' | 'neutro', etiqueta: string, texto: (c: CitaVista) => string) => (
    <Tabla etiqueta={etiqueta}>
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
                {nombreDeCita(nombres, c)}
              </button>
            </Td>
            <Td className="font-semibold">{profesional.get(c.profesionalId) ?? 'Profesional'}</Td>
            <Td className="font-semibold text-neutral-800 first-letter:uppercase">
              {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)}
            </Td>
            <Td>
              <Badge tono={tono}>{texto(c)}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );

  return (
    <div className="flex flex-col gap-5">
      <Panel
        titulo="Pago pendiente"
        bajada="Se confirman con el pago (portal del paciente, transferencia validada o pago registrado en Cobros). Si vence el plazo sin pago, la que agendó el equipo se mantiene y se paga en el centro; la que pidió el paciente se libera."
      >
        <div className="mt-4">
          <EstadoConsulta consulta={porPagar} vacio={(l) => l.length === 0} textoVacio="No hay horas con pago pendiente">
            {(l) => lista(l, 'atencion', 'Pago pendiente', (c) => (c.pagoVenceEn ? `Hasta ${formatoFechaHora(c.pagoVenceEn)}` : 'Pago pendiente'))}
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
                () => 'Por reprogramar',
              )
            }
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}
