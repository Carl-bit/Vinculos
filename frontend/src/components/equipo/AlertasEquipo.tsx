'use client';

import { ListaPaginada } from '@/components/ui/Paginador';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { formatoFechaHora } from '@/lib/formato';
import { useEquipoAgenda } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

const TIPO = {
  BAJA_SIN_ADMIN: 'Baja sin otra cuenta madre',
  FALLO_CANARIO: 'Alerta de seguridad',
  BAJA_CON_BORRADORES: 'Baja con borradores sin confirmar',
  POSIBLE_DUPLICADO: 'Posible paciente duplicado',
  SOLICITUD_DERECHO_POR_VENCER: 'Solicitud de datos por vencer',
  ACCESO_ANOMALO: 'Acceso inusual a fichas',
  LOGIN_FALLIDO_REPETIDO: 'Ingresos fallidos repetidos',
  ATENCION_TEMPORAL: 'Paciente pide atención temporal',
} as const;

/**
 * Alertas internas (ADMIN) y bajas programadas (ADMIN/GESTION). Los pacientes
 * por reasignar viven en Fichas y Pacientes (punto 33).
 */
export function AlertasEquipo({ rol }: { rol: Rol }) {
  const admin = rol === 'ADMIN';
  const cliente = useQueryClient();
  const directorio = useEquipoAgenda();
  const nombre = new Map((directorio.data ?? []).map((m) => [m.id, m.nombre ?? 'Integrante']));
  const alertas = useQuery({ queryKey: ['equipo', 'alertas'], queryFn: () => datos(api.GET('/api/alertas')), enabled: admin });
  const bajas = useQuery({ queryKey: ['equipo', 'bajas'], queryFn: () => datos(api.GET('/api/bajas')) });
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
              {(todos) => (
                <ListaPaginada items={todos} clave="alertas-internas" etiqueta="alertas">
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
                </ListaPaginada>
              )}
            </EstadoConsulta>
          </div>
        </Panel>
      )}
      <Panel titulo="Bajas programadas" bajada="Desde la fecha efectiva la agenda queda bloqueada; la cuenta se cierra en los minutos siguientes.">
        <div className="mt-4">
          <EstadoConsulta consulta={bajas} vacio={(l) => l.length === 0} textoVacio="Sin bajas programadas">
            {(todos) => (
              <ListaPaginada items={todos} clave="bajas-programadas" etiqueta="bajas">
                {(l) => (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {l.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-bg px-4 py-2.5 text-[13.5px]">
                        <span className="min-w-0 flex-1 font-extrabold">{nombre.get(b.usuarioId) ?? 'Integrante'}</span>
                        <span className="font-semibold text-neutral-800">Efectiva el {formatoFechaHora(b.fechaEfectiva)}</span>
                        <Badge tono={b.procesadaEn ? 'neutro' : 'atencion'}>{b.procesadaEn ? 'Procesada' : 'Programada'}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ListaPaginada>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}
