'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ESTADO_LIQUIDACION, useLiquidaciones } from '@/lib/cobros';
import { descargarArchivo } from '@/lib/descargas';
import { formatoClp, formatoFecha } from '@/lib/formato';
import { fechaHoyChile, sumarDias } from '@/lib/panel';

import { LETRA, cargos } from './AcuerdosProfesionales';

const QUIEN_COBRA = { CENTRO: 'Cobra el centro', PROFESIONAL: 'Cobras tú' } as const;

/**
 * Mi acuerdo con el centro (Mi cuenta > Pagos y liquidaciones): el vigente y,
 * si ya hay uno programado, el proximo. Solo lectura: lo define la cuenta
 * madre (Cobros > Acuerdos). La RLS entrega al profesional solo los suyos.
 */
export function MiAcuerdo() {
  const acuerdos = useQuery({ queryKey: ['cobros', 'acuerdos'], queryFn: () => datos(api.GET('/api/cobros/acuerdos')) });
  const hoy = fechaHoyChile();
  return (
    <Panel titulo="Mi acuerdo con el centro" bajada="Lo define la administración; si algo no calza, escríbele.">
      <EstadoConsulta consulta={acuerdos} vacio={(l) => l.length === 0} textoVacio="Sin acuerdo propio: rigen las reglas generales del centro">
        {(l) => {
          const orden = [...l].sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
          const vigente = orden.find((a) => a.vigenteDesde.slice(0, 10) <= hoy);
          const proximo = orden.find((a) => a.vigenteDesde.slice(0, 10) > hoy);
          return (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {[vigente, proximo].map(
                (a, i) =>
                  a && (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-divider bg-bg px-3.5 py-3">
                      <span className="flex min-w-[220px] flex-1 flex-col">
                        <strong>
                          {QUIEN_COBRA[a.cobra]} (acuerdo {LETRA[a.modelo]})
                        </strong>
                        <span className="text-[12.5px] font-semibold text-neutral-700">{cargos(a)}</span>
                      </span>
                      <Badge tono={i === 0 ? 'positivo' : 'atencion'}>
                        {i === 0 ? 'Vigente' : 'Desde'} {formatoFecha(a.vigenteDesde.slice(0, 10))}
                      </Badge>
                    </li>
                  ),
              )}
            </ul>
          );
        }}
      </EstadoConsulta>
      <div className="mt-3">
        <ButtonLink href="/admin/mensajes" variant="secondary" icon="mail" className="!py-2.5">
          Escribir a administración
        </ButtonLink>
      </div>
    </Panel>
  );
}

/** Mis liquidaciones emitidas (documento informativo, no tributario), con su PDF. */
export function MisLiquidaciones() {
  const lista = useLiquidaciones();
  const [error, setError] = useState<string>();
  const pdf = async (id: string) => {
    const r = await descargarArchivo(`/api/cobros/liquidaciones/${id}/pdf`, 'liquidacion.pdf');
    setError(r === 'listo' ? undefined : 'No pudimos descargar el PDF de la liquidación.');
  };
  return (
    <Panel
      titulo="Liquidaciones"
      bajada="Documento informativo, no tributario."
      accion={
        <ButtonLink href="/admin/cobros" variant="ghost" icon="arrow_forward" className="!py-2">
          Ver en Cobros
        </ButtonLink>
      }
    >
      <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Todavía no tienes liquidaciones emitidas">
        {(l) => (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {l.slice(0, 6).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-divider bg-bg px-3.5 py-3">
                <span className="flex min-w-[220px] flex-1 flex-col">
                  <strong>
                    {formatoFecha(x.periodoDesde)} al {formatoFecha(sumarDias(x.periodoHasta.slice(0, 10), -1))}
                  </strong>
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Cobrado {formatoClp(x.totalCobrado)} · {x.total >= 0 ? `recibes ${formatoClp(x.total)}` : `debes al centro ${formatoClp(-x.total)}`}
                  </span>
                </span>
                <Badge tono={ESTADO_LIQUIDACION[x.estado].tono}>{ESTADO_LIQUIDACION[x.estado].texto}</Badge>
                <Button variant="secondary" icon="download" onClick={() => void pdf(x.id)} className="!py-2">
                  PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
      {error && (
        <p role="alert" className="m-0 mt-2 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </Panel>
  );
}
