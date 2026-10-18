'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { formatoFecha, formatoFechaHora } from '@/lib/formato';
import { useEquipoAgenda } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

const TIPO = {
  BAJA_SIN_ADMIN: 'Baja sin otra cuenta madre',
  FALLO_CANARIO: 'Alerta de seguridad',
  BAJA_CON_BORRADORES: 'Baja con borradores sin confirmar',
  POSIBLE_DUPLICADO: 'Posible paciente duplicado',
} as const;

/**
 * Alertas internas (ADMIN), bajas programadas y pacientes por reasignar
 * (ADMIN/GESTION). La reasignacion es una derivacion de oficio desde la ficha
 * del paciente; nunca un cambio de rol.
 */
export function AlertasEquipo({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  const cliente = useQueryClient();
  const directorio = useEquipoAgenda();
  const nombre = new Map((directorio.data ?? []).map((m) => [m.id, m.nombre ?? 'Integrante']));
  const alertas = useQuery({ queryKey: ['equipo', 'alertas'], queryFn: () => datos(api.GET('/api/alertas')), enabled: admin });
  const bajas = useQuery({ queryKey: ['equipo', 'bajas'], queryFn: () => datos(api.GET('/api/bajas')) });
  const porReasignar = useQuery({ queryKey: ['equipo', 'por-reasignar'], queryFn: () => datos(api.GET('/api/bajas/por-reasignar')) });
  const atender = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/alertas/{id}/atendida', { params: { path: { id } } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['equipo', 'alertas'] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
    },
  });
  return (
    <div className="flex flex-col gap-6">
      {admin && (
        <Panel titulo="Alertas internas" bajada="Situaciones que necesitan una decisión de la cuenta madre.">
          <div className="mt-4">
            <EstadoConsulta consulta={alertas} vacio={(l) => l.length === 0} textoVacio="Sin alertas">
              {(l) => (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {l.map((a) => (
                    <li
                      key={a.id}
                      className={`flex flex-wrap items-center gap-3 rounded-[14px] border px-4 py-3 ${a.atendidaEn ? 'border-divider bg-bg' : 'border-accent-500 bg-accent-100'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[14px] font-extrabold">{TIPO[a.tipo]}</p>
                        <p className="m-0 text-[13px] font-semibold text-neutral-800">{a.detalle}</p>
                        <p className="m-0 text-[12px] font-semibold text-neutral-700">{formatoFechaHora(a.creadaEn)}</p>
                      </div>
                      {a.atendidaEn ? (
                        <Badge tono="neutro">Atendida</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          icon="check"
                          loading={atender.isPending && atender.variables === a.id}
                          onClick={() => atender.mutate(a.id)}
                          className="!py-2"
                        >
                          Marcar atendida
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </EstadoConsulta>
          </div>
        </Panel>
      )}
      <Panel titulo="Pacientes por reasignar" bajada="Su tratante dejó el centro o perdió el acceso. Se reasignan con una derivación de oficio desde la ficha.">
        <div className="mt-4">
          <EstadoConsulta consulta={porReasignar} vacio={(l) => l.length === 0} textoVacio="No hay pacientes por reasignar">
            {(l) => (
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
                  {l.map((p) => (
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
            )}
          </EstadoConsulta>
        </div>
      </Panel>
      <Panel titulo="Bajas programadas" bajada="Desde la fecha efectiva la agenda queda bloqueada; el proceso nocturno cierra la cuenta.">
        <div className="mt-4">
          <EstadoConsulta consulta={bajas} vacio={(l) => l.length === 0} textoVacio="Sin bajas programadas">
            {(l) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {l.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-bg px-4 py-2.5 text-[13.5px]">
                    <span className="min-w-0 flex-1 font-extrabold">{nombre.get(b.usuarioId) ?? 'Integrante'}</span>
                    <span className="font-semibold text-neutral-800">Efectiva el {formatoFecha(b.fechaEfectiva)}</span>
                    <Badge tono={b.procesadaEn ? 'neutro' : 'atencion'}>{b.procesadaEn ? 'Procesada' : 'Programada'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}
