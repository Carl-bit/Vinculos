'use client';

import Link from 'next/link';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { useDeudas } from '@/lib/cobros';
import { useModulos } from '@/lib/consultas';
import { formatoClp, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { useCitas, useEstadoFichas, usePacientes } from '@/lib/panel';

/**
 * "Mis horas e informacion de pacientes" (diseño "Admin - Mi Perfil"): mis
 * pacientes con su proxima sesion y estado administrativo (ficha sin cerrar,
 * al dia, alta). Con Cobros activo, ademas el estado de pago (03b-4.1
 * pendiente 9): "Con deuda" (sesion realizada con saldo) o "Pago pendiente"
 * (hora futura que espera el pago para confirmarse). "Por confirmar" ya no
 * existe: desde 03b-3.2 la hora se confirma con el pago. Sin contenido
 * clinico: eso vive en la ficha.
 */
export function MisPacientesEstado({ profesionalId }: { profesionalId: string }) {
  const pacientes = usePacientes({ profesionalId });
  const estados = useEstadoFichas(profesionalId);
  const porPaciente = new Map((estados.data ?? []).map((e) => [e.paciente_id, e]));
  const cobros = (useModulos().data?.activos ?? []).includes('COBROS');
  const deudas = new Map((useDeudas(cobros).data ?? []).map((d) => [d.paciente_id, d]));
  const [desde] = useState(() => new Date().toISOString());
  const porPagar = new Set(
    (useCitas({ profesionalId, estado: 'PENDIENTE_PAGO', desde }, cobros).data ?? []).map((c) => c.pacienteId).filter((id): id is string => !!id),
  );
  return (
    <Panel
      titulo="Mis horas e información de pacientes"
      accion={
        <Link href="/admin/fichas" className="flex min-h-10 items-center gap-1.5 text-[13.5px] font-extrabold">
          <Icon name="folder_open" size={17} />
          Ver mis fichas
        </Link>
      }
    >
      <div className="mt-3 mb-2.5 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">Mis pacientes</div>
      <EstadoConsulta consulta={pacientes} vacio={(l) => l.length === 0} textoVacio="Todavía no tienes pacientes asignados">
        {(lista) => {
          const filas = lista
            .map((p) => ({ p, e: porPaciente.get(p.id) }))
            .sort((a, b) => (a.e?.proxima_sesion ?? '9').localeCompare(b.e?.proxima_sesion ?? '9'))
            .slice(0, 8);
          return (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {filas.map(({ p, e }) => {
                const estado: { texto: string; tono: TonoBadge } = e?.alta_en
                  ? { texto: 'Alta', tono: 'neutro' }
                  : (e?.sesiones_sin_cerrar ?? 0) > 0
                    ? { texto: 'Ficha sin cerrar', tono: 'atencion' }
                    : { texto: 'Al día', tono: 'positivo' };
                const deuda = deudas.get(p.id);
                const pago: { texto: string; tono: TonoBadge } | null = deuda
                  ? { texto: `Con deuda · ${formatoClp(deuda.saldo)}`, tono: 'atencion' }
                  : porPagar.has(p.id)
                    ? { texto: 'Pago pendiente', tono: 'neutro' }
                    : null;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/admin/fichas/${p.id}`}
                      className="flex items-center gap-3.5 rounded-[18px] border border-divider bg-bg px-4 py-3 text-text transition-shadow duration-200 hover:text-text hover:shadow-md"
                    >
                      <Avatar name={`${p.nombre} ${p.apellido}`} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-black tracking-[-0.01em]">
                          {p.nombre} {p.apellido}
                        </span>
                        <span className="block text-[12.5px] font-semibold text-neutral-700">
                          {e?.proxima_sesion ? `${formatoFechaLarga(e.proxima_sesion)}, ${formatoHora(e.proxima_sesion)}` : 'Sin sesión agendada'}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Badge tono={estado.tono}>{estado.texto}</Badge>
                        {pago && <Badge tono={pago.tono}>{pago.texto}</Badge>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </EstadoConsulta>
      <p className="m-0 mt-3.5 flex gap-2.5 rounded-[18px] border border-divider bg-bg px-4 py-3 text-[12.5px] font-bold text-neutral-800">
        <Icon name="lock" size={17} />
        Este panel muestra solo estado administrativo. El contenido clínico vive en la ficha de cada paciente.
      </p>
    </Panel>
  );
}
