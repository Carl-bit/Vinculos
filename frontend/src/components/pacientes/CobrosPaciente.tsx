'use client';

import { useQuery } from '@tanstack/react-query';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { formatoClp, formatoFecha, formatoHora } from '@/lib/formato';

type EstadoPago = components['schemas']['EstadoPagoCita'];

const ESTADO: Record<EstadoPago, { texto: string; tono: TonoBadge }> = {
  SIN_COBRO: { texto: 'Sin cobro', tono: 'neutro' },
  PENDIENTE: { texto: 'Pendiente', tono: 'atencion' },
  PARCIAL: { texto: 'Pago parcial', tono: 'atencion' },
  PAGADO: { texto: 'Pagado', tono: 'positivo' },
};

/** Cobros del paciente (estado_pago_citas bajo la RLS de quien consulta). Los registra el modulo Cobros. */
export function usePagosPaciente(pacienteId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['panel', 'cobros-citas', 'paciente', pacienteId],
    // ponytail: el listado no filtra por paciente (tope 500 filas); agregar ?pacienteId a la API si el centro crece.
    queryFn: async () => (await datos(api.GET('/api/cobros/citas'))).filter((c) => c.paciente_id === pacienteId),
    enabled: habilitado,
  });
}

/** Pestaña Cobros de la vista del paciente (03b-4.2): monto, pagado, saldo y estado por sesion. */
export function CobrosPaciente({ pacienteId }: { pacienteId: string }) {
  const cobros = usePagosPaciente(pacienteId, true);
  return (
    <Panel titulo="Cobros" bajada="Monto fijado al confirmar cada sesión, lo pagado y el saldo. Los pagos se registran en Cobros.">
      <div className="mt-4">
        <EstadoConsulta consulta={cobros} vacio={(l) => l.length === 0} textoVacio="Sin cobros registrados">
          {(lista) => (
            <Tabla etiqueta="Cobros del paciente">
              <thead>
                <tr>
                  <Th>Sesión</Th>
                  <Th>Monto</Th>
                  <Th>Pagado</Th>
                  <Th>Saldo</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {[...lista]
                  .sort((a, b) => b.inicio.localeCompare(a.inicio))
                  .map((c) => (
                    <tr key={c.cita_id}>
                      <Td className="font-semibold">
                        {formatoFecha(c.inicio)}, {formatoHora(c.inicio)}
                      </Td>
                      <Td className="tabular-nums">{c.monto != null ? formatoClp(c.monto) : '—'}</Td>
                      <Td className="tabular-nums">{formatoClp(c.pagado)}</Td>
                      <Td className={`tabular-nums ${c.saldo > 0 ? 'font-extrabold text-accent-700' : ''}`}>{formatoClp(c.saldo)}</Td>
                      <Td>
                        <Badge tono={ESTADO[c.estado_pago].tono}>{c.inasistencia ? 'No asistió' : ESTADO[c.estado_pago].texto}</Badge>
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Tabla>
          )}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}
