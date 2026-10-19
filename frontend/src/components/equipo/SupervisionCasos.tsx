'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ComentariosSupervision } from '@/components/shared/ComentariosSupervision';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { ValoresPlantilla } from '@/components/shared/ValoresPlantilla';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { NIVEL_RIESGO, usePlantillas } from '@/lib/fichas';
import { formatoFechaHora } from '@/lib/formato';
import { useEquipoAgenda } from '@/lib/panel';

type EvolucionSupervisada = components['schemas']['EvolucionSupervisada'];

/**
 * Supervision seudonimizada (02e): el supervisor ve sus casos por codigo
 * (edad y tipo de atencion; nunca nombre, RUT ni ficha) y las evoluciones de
 * sus practicantes con los campos estructurados, las notas y solo los campos
 * de plantilla marcados como visibles en supervision. Comenta cada evolucion
 * (append-only); el practicante lee los comentarios en su ficha.
 */
export function SupervisionCasos() {
  const casos = useQuery({ queryKey: ['supervision', 'casos'], queryFn: () => datos(api.GET('/api/supervision/casos')) });
  const equipo = useEquipoAgenda();
  const nombre = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Practicante']));
  const [codigo, setCodigo] = useState<string | null>(null);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Panel titulo="Casos supervisados" bajada="Por código: sin nombre ni datos de contacto del paciente.">
        <div className="mt-4">
          <EstadoConsulta consulta={casos} vacio={(l) => l.length === 0} textoVacio="No supervisas casos">
            {(lista) => (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {lista.map((c) => (
                  <li key={c.codigo}>
                    <button
                      type="button"
                      aria-pressed={codigo === c.codigo}
                      onClick={() => setCodigo(c.codigo)}
                      className={`flex min-h-12 w-full cursor-pointer flex-col items-start rounded-lg px-3.5 py-2.5 text-left transition-colors duration-200 ease-out ${codigo === c.codigo ? 'bg-accent-200' : 'hover:bg-accent-100'}`}
                    >
                      <span className="font-mono text-[14px] font-extrabold">{c.codigo}</span>
                      <span className="text-[12.5px] font-semibold text-neutral-700">
                        {c.edad_paciente} años{c.tipo_atencion ? ` · ${c.tipo_atencion}` : ''} · {nombre.get(c.practicante_id) ?? 'Practicante'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
      <div className="min-w-0">
        {codigo ? (
          <EvolucionesCaso codigo={codigo} />
        ) : (
          <p className="m-0 py-6 text-[14px] font-semibold text-neutral-800">Elige un caso para ver sus evoluciones.</p>
        )}
      </div>
    </div>
  );
}

function EvolucionesCaso({ codigo }: { codigo: string }) {
  const evoluciones = useQuery({
    queryKey: ['supervision', 'evoluciones', codigo],
    queryFn: () => datos(api.GET('/api/supervision/casos/{codigo}/evoluciones', { params: { path: { codigo } } })),
  });
  // Etiquetas de los campos: definicion de la version de plantilla con que se escribio cada evolucion.
  const plantillas = usePlantillas();
  const definicion = new Map((plantillas.data ?? []).map((p) => [p.id, p.definicion]));
  return (
    <section aria-label={`Evoluciones del caso ${codigo}`} className="flex flex-col gap-3.5">
      <h2 className="m-0 font-mono text-[20px] font-black">{codigo}</h2>
      <EstadoConsulta consulta={evoluciones} vacio={(l) => l.length === 0} textoVacio="El caso todavía no tiene evoluciones">
        {(lista) =>
          [...lista]
            .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
            .map((e) => <EvolucionCaso key={e.evolucionId} evolucion={e} campos={e.plantilla ? (definicion.get(e.plantilla.id) ?? []) : []} />)
        }
      </EstadoConsulta>
    </section>
  );
}

function EvolucionCaso({ evolucion: e, campos }: { evolucion: EvolucionSupervisada; campos: components['schemas']['CampoPlantillaDto'][] }) {
  const riesgo = NIVEL_RIESGO[e.nivelRiesgo];
  const visibles = campos.filter((c) => e.valores && c.clave in e.valores);
  return (
    <article className="rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="m-0 text-[15px] font-black">{e.tipoSesion}</p>
          <p className="m-0 text-[12.5px] font-semibold text-neutral-700">{formatoFechaHora(e.creadoEn)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e.corrigeAId && <Badge tono="atencion">Corrección</Badge>}
          <Badge tono={riesgo.tono}>{riesgo.texto}</Badge>
        </div>
      </div>
      {(e.estadoAvance || e.intervenciones.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {e.estadoAvance && <Badge>Avance: {e.estadoAvance}</Badge>}
          {e.intervenciones.map((i) => (
            <Badge key={i}>{i}</Badge>
          ))}
        </div>
      )}
      {e.plantilla && visibles.length > 0 && (
        <div className="mt-3.5 border-t border-divider pt-3">
          <p className="m-0 mb-2.5 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">
            {e.plantilla.nombre} · versión {e.plantilla.version} · campos visibles en supervisión
          </p>
          <ValoresPlantilla campos={visibles} valores={e.valores as Record<string, string> | null} />
          {e.camposTextoLibre.length > 0 && <p className="m-0 mt-2 text-[12px] font-semibold text-neutral-700">{e.advertenciaTextoLibre}</p>}
        </div>
      )}
      {e.notas && (
        <div className="mt-3.5 border-t border-divider pt-3">
          <p className="m-0 mb-1.5 text-xs font-extrabold text-neutral-700">Notas</p>
          <p className="m-0 text-[14.5px] leading-relaxed font-semibold whitespace-pre-line text-pretty">{e.notas}</p>
        </div>
      )}
      <ComentariosSupervision evolucionId={e.evolucionId} puedeComentar />
    </article>
  );
}
