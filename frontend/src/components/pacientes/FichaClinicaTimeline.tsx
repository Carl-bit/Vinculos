'use client';

import { ComentariosSupervision } from '@/components/shared/ComentariosSupervision';
import { ValoresPlantilla } from '@/components/shared/ValoresPlantilla';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { correccionesDe, NIVEL_RIESGO, type EvolucionVista } from '@/lib/fichas';
import { formatoFechaHora, formatoFechaLarga } from '@/lib/formato';

/**
 * Evoluciones de la ficha (append-only), de la mas reciente a la mas antigua.
 * Una correccion es un registro nuevo que apunta al corregido: los dos se
 * muestran, enlazados, y nada se reescribe. Cada registro se lee con la
 * version de plantilla con que se escribio.
 */
export function FichaClinicaTimeline({
  evoluciones,
  miId,
  onCorregir,
  conSupervision = false,
}: {
  evoluciones: readonly EvolucionVista[];
  miId: string | undefined;
  onCorregir: (e: EvolucionVista) => void;
  /** Practicante: muestra los comentarios del supervisor bajo cada evolucion. */
  conSupervision?: boolean;
}) {
  const corregidas = correccionesDe(evoluciones);
  const porId = new Map(evoluciones.map((e) => [e.id, e]));
  const lista = [...evoluciones].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
      {lista.map((e) => {
        const correccion = corregidas.get(e.id);
        const original = e.corrigeAId ? porId.get(e.corrigeAId) : undefined;
        const riesgo = e.nivelRiesgo ? NIVEL_RIESGO[e.nivelRiesgo] : undefined;
        return (
          <li
            key={e.id}
            id={`evolucion-${e.id}`}
            className={`scroll-mt-24 rounded-lg border bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4 ${correccion ? 'border-dashed border-neutral-400' : 'border-divider'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="m-0 text-[15px] font-black">{e.tipoSesion?.nombre ?? 'Evolución'}</p>
                <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                  {formatoFechaHora(e.createdAt)} · {e.copiaAutoria.nombre ?? 'Autor'}
                  {e.copiaAutoria.registro && e.copiaAutoria.registro !== 'sin registro' ? ` · Reg. ${e.copiaAutoria.registro}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {e.corrigeAId && <Badge tono="atencion">Corrección</Badge>}
                {correccion && <Badge tono="neutro">Corregida</Badge>}
                {riesgo && <Badge tono={riesgo.tono}>{riesgo.texto}</Badge>}
              </div>
            </div>

            {(e.estadoAvance || e.intervenciones.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {e.estadoAvance && <Badge>Avance: {e.estadoAvance.nombre}</Badge>}
                {e.intervenciones.map((i) => (
                  <Badge key={i.id}>{i.nombre}</Badge>
                ))}
              </div>
            )}

            {e.plantilla && (
              <div className="mt-3.5 border-t border-divider pt-3">
                <p className="m-0 mb-2.5 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">
                  {e.plantilla.nombre} · versión {e.plantilla.version}
                </p>
                <ValoresPlantilla campos={e.plantilla.definicion} valores={e.valores as Record<string, string> | null} />
              </div>
            )}

            {e.notas && (
              <div className="mt-3.5 border-t border-divider pt-3">
                <p className="m-0 mb-1.5 text-xs font-extrabold text-neutral-700">Notas</p>
                <p className="m-0 text-[14.5px] leading-relaxed font-semibold whitespace-pre-line text-pretty">{e.notas}</p>
              </div>
            )}

            {conSupervision && <ComentariosSupervision evolucionId={e.id} puedeComentar={false} />}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-1 text-[12.5px] font-semibold text-neutral-700">
                {original && (
                  <a href={`#evolucion-${original.id}`} className="flex items-center gap-1.5 font-extrabold text-accent-700 hover:text-accent-800">
                    <Icon name="history" size={16} />
                    Corrige el registro del {formatoFechaLarga(original.createdAt)}
                  </a>
                )}
                {correccion && (
                  <a href={`#evolucion-${correccion.id}`} className="flex items-center gap-1.5 font-extrabold text-accent-700 hover:text-accent-800">
                    <Icon name="history" size={16} />
                    Ver la corrección del {formatoFechaLarga(correccion.createdAt)}
                  </a>
                )}
              </div>
              {miId === e.autorId && !correccion && (
                <Button variant="ghost" icon="edit_note" onClick={() => onCorregir(e)} className="!px-3.5 !py-2 !text-[13px]">
                  Corregir
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
