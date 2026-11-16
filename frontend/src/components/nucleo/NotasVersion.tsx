'use client';

import { useQuery } from '@tanstack/react-query';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { formatoFecha } from '@/lib/formato';

/**
 * R6: novedades de cada version de la plataforma, que escribe el equipo de
 * Vinculos y llegan al actualizar el silo. Texto plano (sin HTML): los saltos
 * de linea se respetan.
 */
export function NotasVersion() {
  const notas = useQuery({ queryKey: ['configuracion', 'notas-version'], queryFn: () => datos(api.GET('/api/configuracion/notas-version')) });
  return (
    <Panel titulo="Novedades de la plataforma" bajada="Qué cambió en cada versión que Vinculos instaló en tu centro.">
      <EstadoConsulta consulta={notas} vacio={(l) => l.length === 0} textoVacio="Aún no hay novedades: aparecerán aquí cuando se actualice la plataforma">
        {(lista) => (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {lista.map((n) => (
              <li key={n.version} className="flex flex-col gap-1.5 border-b border-divider pb-4 last:border-b-0 last:pb-0">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 text-[15px] font-extrabold">
                  Versión {n.version}
                  <span className="text-[12.5px] font-semibold text-neutral-700">{formatoFecha(n.recibidaEn)}</span>
                </p>
                <p className="m-0 text-[14px] leading-relaxed whitespace-pre-line text-pretty">{n.notas}</p>
              </li>
            ))}
          </ol>
        )}
      </EstadoConsulta>
    </Panel>
  );
}
