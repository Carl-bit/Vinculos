'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Encabezado } from '@/components/shared/Encabezado';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pestanas } from '@/components/ui/Pestanas';
import { periodoChile, type Periodo } from '@/lib/cobros';
import { descargarArchivo } from '@/lib/descargas';
import { formatoFecha } from '@/lib/formato';
import { sumarDias } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { LiquidacionesCobros } from './LiquidacionesCobros';
import { ResumenCobros } from './ResumenCobros';
import { SesionesPorCobrar } from './SesionesPorCobrar';

type Vista = 'resumen' | 'sesiones' | 'liquidaciones';
const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: 'resumen', etiqueta: 'Resumen del período' },
  { valor: 'sesiones', etiqueta: 'Asistencia y pago' },
  { valor: 'liquidaciones', etiqueta: 'Liquidaciones' },
];
const mes = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const nombrePeriodo = (p: Periodo) =>
  p.tipo === 'mes'
    ? mes.format(new Date(`${p.desde}T12:00:00Z`))
    : `${formatoFecha(p.desde).replace(/ de \d{4}$/, '')} al ${formatoFecha(sumarDias(p.hasta, -1))}`;

/**
 * Cobros (diseño "Admin - Cobros"): cada atencion cobrada nace de una cita de
 * Agenda. Resumen por profesional, "registrar asistencia y pago" de las
 * sesiones realizadas y liquidaciones segun las citas realizadas. Parametro
 * `?vista=`.
 */
export function CobrosCentro({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const router = useRouter();
  const parametros = useSearchParams();
  const vista = VISTAS.find((v) => v.valor === parametros.get('vista'))?.valor ?? 'resumen';
  const [tipo, setTipo] = useState<Periodo['tipo']>('mes');
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [aviso, setAviso] = useState<string>();
  const periodo = periodoChile(tipo, desplazamiento);
  const ir = (v: Vista) => router.replace(v === 'resumen' ? '/admin/cobros' : `/admin/cobros?vista=${v}`, { scroll: false });
  const exportar = async () => {
    const r = await descargarArchivo(`/api/cobros/reporte/pdf?desde=${periodo.desde}&hasta=${periodo.hasta}`, `cobros-${periodo.desde}.pdf`);
    setAviso(r === 'listo' ? undefined : 'No pudimos exportar el período. Intenta de nuevo.');
  };

  return (
    <>
      <Encabezado
        tono="team"
        sobretitulo="Cobros"
        titulo={admin ? 'Liquidaciones del centro' : 'Mis cobros'}
        bajada={admin ? 'Sesiones realizadas, pagos y liquidaciones por profesional.' : 'Tus sesiones realizadas, lo cobrado y tus liquidaciones.'}
        accion={
          <Button variant="secondary" icon="picture_as_pdf" onClick={() => void exportar()}>
            Exportar período
          </Button>
        }
      />
      <p className="m-0 mb-[22px] flex items-center gap-2 text-[13px] font-semibold text-neutral-700">
        <Icon name="receipt_long" size={17} />
        Las atenciones cobradas nacen de una cita en Agenda y Espacios y se registran con la asistencia de cada sesión.
      </p>
      {aviso && (
        <p role="alert" className="m-0 mb-4 text-[13px] font-bold text-accent-700">
          {aviso}
        </p>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-3.5">
        <div role="radiogroup" aria-label="Período" className="flex rounded-full border border-divider bg-bg p-[3px]">
          {(['semana', 'mes'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              onClick={() => {
                setTipo(t);
                setDesplazamiento(0);
              }}
              className={`min-h-9 cursor-pointer rounded-full px-[17px] text-[12.5px] font-extrabold transition-colors duration-200 ${tipo === t ? 'bg-accent-700 text-neutral-100' : 'text-neutral-700 hover:bg-accent-100'}`}
            >
              {t === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Período anterior"
            onClick={() => setDesplazamiento((d) => d - 1)}
            className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
          >
            <Icon name="chevron_left" />
          </button>
          <span className="min-w-[190px] text-center text-[13.5px] font-extrabold text-neutral-800 first-letter:uppercase" aria-live="polite">
            {nombrePeriodo(periodo)}
          </span>
          <button
            type="button"
            aria-label="Período siguiente"
            disabled={desplazamiento >= 0}
            onClick={() => setDesplazamiento((d) => d + 1)}
            className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200 disabled:cursor-default disabled:opacity-40"
          >
            <Icon name="chevron_right" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <Pestanas etiqueta="Secciones de cobros" tono="team" valor={vista} onChange={ir} pestanas={VISTAS} panelId="cobros-panel" />
        <div id="cobros-panel" role="tabpanel">
          {vista === 'resumen' && <ResumenCobros periodo={periodo} rol={rol} onLiquidado={() => ir('liquidaciones')} />}
          {vista === 'sesiones' && <SesionesPorCobrar periodo={periodo} rol={rol} />}
          {vista === 'liquidaciones' && <LiquidacionesCobros periodo={periodo} rol={rol} />}
        </div>
      </div>
    </>
  );
}
