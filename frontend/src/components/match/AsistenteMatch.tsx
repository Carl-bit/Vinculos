'use client';

import { useEffect, useRef, useState } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';
import { guardarMatch } from '@/lib/match-memoria';
import { nombreCorto, nombrePerfil, textoTarifa } from '@/lib/perfiles';

import { elegidos, PreguntaMatch, respondida, type Pregunta, type Respuesta } from './PreguntaMatch';

type Resultado = components['schemas']['ResultadoMatch'];
type Opcion = components['schemas']['OpcionResultadoMatch'];

/** "atiende adultos, trabaja ansiedad y tiene horas…" (las razones vienen de la API en minusculas). */
const frase = (razones: string[]) => {
  if (razones.length === 0) return '';
  const t = razones.length === 1 ? razones[0]! : `${razones.slice(0, -1).join(', ')} y ${razones.at(-1)}`;
  return `${t[0]!.toUpperCase()}${t.slice(1)}.`;
};

/**
 * Match terapeutico publico (diseño "Match Publico"): cuestionario configurable
 * paso a paso, analisis por reglas en la API y tarjeta del profesional. No
 * guarda nada ni pide contacto (C-17): el resultado lleva a Pedir hora.
 */
export function AsistenteMatch({ preguntas, agenda }: { preguntas: Pregunta[]; agenda: boolean }) {
  const [paso, setPaso] = useState(0);
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const montado = useRef(false);
  const total = preguntas.length;
  const q = preguntas[paso];
  const listo = (i: number) => !preguntas[i]!.obligatoria || respondida(preguntas[i]!, respuestas[preguntas[i]!.clave]);
  const pct = resultado ? 100 : Math.round((paso / total) * 100);

  // Cambio de paso: el foco va al titulo nuevo (teclado y lector de pantalla siguen el flujo).
  useEffect(() => {
    if (montado.current) titulo.current?.focus();
    montado.current = true;
  }, [paso, resultado]);

  const calcular = async () => {
    setEnviando(true);
    setError(undefined);
    const enviadas = Object.fromEntries(
      Object.entries(respuestas).filter(([, r]) => r !== undefined && (Array.isArray(r) ? r.length : String(r).trim())),
    ) as Record<string, string | string[]>;
    try {
      const r = await datos(api.POST('/api/publico/match', { body: { respuestas: enviadas } }));
      guardarMatch(enviadas, r.recomendado?.perfil.id ?? null);
      setResultado(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos calcular el resultado. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const reiniciar = () => {
    setRespuestas({});
    setResultado(null);
    setPaso(0);
  };

  const resumen = (p: Pregunta) => {
    const r = respuestas[p.clave];
    if (p.tipo === 'TEXTO') return typeof r === 'string' && r.trim() ? 'Escrito' : null;
    const etiquetas = p.opciones.filter((o) => elegidos(r).includes(o.valor)).map((o) => o.etiqueta);
    return etiquetas.length ? etiquetas.join(', ') : null;
  };

  return (
    <div className="flex items-start justify-center gap-[clamp(20px,3vw,40px)] pt-[clamp(10px,2vw,26px)] pb-10">
      <aside className="sticky top-6 hidden w-[292px] flex-none rounded-lg border border-divider bg-neutral-100 px-6 py-[26px] shadow-sm lg:block">
        <Eyebrow tone="patient">Match terapéutico</Eyebrow>
        <div className="mb-1.5 text-[34px] leading-none font-black tracking-[-0.035em] tabular-nums">{pct}%</div>
        <div className="mb-3 text-[12.5px] font-bold text-neutral-700">{resultado ? 'Resultado listo' : `Paso ${paso + 1} de ${total}`}</div>
        <div className="mb-6 h-2 overflow-hidden rounded-full bg-neutral-300" aria-hidden="true">
          <div className="h-full rounded-full bg-accent-700 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {preguntas.map((p, i) => {
            const actual = !resultado && i === paso;
            const hecho = respondida(p, respuestas[p.clave]) && (i < paso || !!resultado);
            const alcanzable = !resultado && i <= paso;
            return (
              <li key={p.clave}>
                <button
                  type="button"
                  disabled={!alcanzable}
                  onClick={() => setPaso(i)}
                  aria-current={actual ? 'step' : undefined}
                  className={`flex w-full items-start gap-[11px] rounded-[14px] px-3 py-[11px] text-left transition-colors duration-200 enabled:cursor-pointer enabled:hover:bg-accent-2-100 ${actual ? 'bg-accent-2-200' : ''}`}
                >
                  <Icon
                    name={hecho ? 'check_circle' : actual ? 'radio_button_checked' : 'radio_button_unchecked'}
                    size={19}
                    className={`mt-px ${hecho || actual ? 'text-accent-2-700' : 'text-neutral-500'} ${hecho ? "[font-variation-settings:'FILL'_1]" : ''}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-[1.3] tracking-[-0.015em] ${actual ? 'font-black' : 'font-bold'}`}>{p.texto}</span>
                    <span className="mt-[3px] block truncate text-[12.5px] font-semibold text-neutral-700">
                      {actual ? 'Respondiendo ahora' : (resumen(p) ?? (i < paso || resultado ? 'Sin respuesta' : 'Pendiente'))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="m-0 mt-[22px] flex gap-2.5 border-t border-divider pt-[18px] text-[12.5px] leading-normal font-semibold text-pretty text-neutral-700">
          <Icon name="lock" size={17} />
          Tus respuestas no se guardan: solo sirven para sugerirte un profesional del centro.
        </p>
      </aside>

      <section className="w-full max-w-[720px] min-w-0 rounded-lg border border-divider bg-bg p-[clamp(22px,4vw,40px)] shadow-md">
        <div className="mb-[22px] lg:hidden">
          <div className="mb-[9px] flex items-center justify-between gap-3">
            <span className="text-[11px] font-extrabold tracking-[0.14em] text-accent-700 uppercase">Match terapéutico</span>
            <span className="text-xs font-extrabold text-neutral-700">{resultado ? 'Resultado' : `Paso ${paso + 1} de ${total}`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-300" aria-hidden="true">
            <div className="h-full rounded-full bg-accent-700 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {resultado ? (
          <ResultadoMatch resultado={resultado} agenda={agenda} titulo={titulo} onReiniciar={reiniciar} />
        ) : (
          q && (
            <div key={q.clave} className="entrada">
              <h1
                ref={titulo}
                tabIndex={-1}
                className="m-0 mb-2.5 text-[clamp(25px,3.2vw,36px)] leading-[1.08] font-black tracking-[-0.035em] text-balance outline-none"
              >
                {q.texto}
              </h1>
              {q.ayuda && <p className="m-0 mb-[26px] max-w-[56ch] text-[15.5px] leading-relaxed font-medium text-pretty text-neutral-700">{q.ayuda}</p>}
              <PreguntaMatch pregunta={q} valor={respuestas[q.clave]} onChange={(r) => setRespuestas((a) => ({ ...a, [q.clave]: r }))} />
              {error && (
                <p role="alert" className="m-0 mt-5 text-sm font-bold text-accent-700">
                  {error}
                </p>
              )}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                {paso > 0 ? (
                  <Button variant="ghost" icon="arrow_back" onClick={() => setPaso(paso - 1)}>
                    Anterior
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-3">
                  {!listo(paso) && <span className="text-[13px] font-bold text-neutral-700">Responde para continuar.</span>}
                  {paso < total - 1 ? (
                    <Button variant="team" size="lg" disabled={!listo(paso)} onClick={() => setPaso(paso + 1)}>
                      Continuar
                      <Icon name="arrow_forward" size={19} />
                    </Button>
                  ) : (
                    <Button variant="team" size="lg" icon="join" disabled={!listo(paso)} loading={enviando} onClick={() => void calcular()}>
                      Ver mi resultado
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}

function ResultadoMatch({
  resultado,
  agenda,
  titulo,
  onReiniciar,
}: {
  resultado: Resultado;
  agenda: boolean;
  titulo: React.RefObject<HTMLHeadingElement | null>;
  onReiniciar: () => void;
}) {
  const r = resultado.recomendado;
  return (
    <div className="entrada flex flex-col gap-4">
      <div>
        <Eyebrow tone="patient">Tu resultado</Eyebrow>
        <h1
          ref={titulo}
          tabIndex={-1}
          className="m-0 mb-2 text-[clamp(25px,3.2vw,36px)] leading-[1.08] font-black tracking-[-0.035em] text-balance outline-none"
        >
          {r ? `Te sugerimos a ${nombrePerfil(r.perfil)}` : 'No encontramos a alguien que calce con todo'}
        </h1>
        {resultado.resumen.length > 0 && (
          <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0" aria-label="Lo que marcaste">
            {resultado.resumen.map((e) => (
              <li key={e} className="rounded-full border border-divider bg-neutral-100 px-3.5 py-[7px] text-[12.5px] font-extrabold">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>

      {resultado.avisos.map((a) => (
        <p
          key={a}
          role="alert"
          className="m-0 flex gap-[11px] rounded-[18px] border border-accent-500 bg-accent-200 px-[17px] py-[15px] text-[14px] font-extrabold text-accent-900"
        >
          <Icon name="call" size={19} />
          {a}
        </p>
      ))}

      {r ? (
        <TarjetaResultado opcion={r} agenda={agenda} destacada />
      ) : (
        <p className="m-0 text-[15px] font-semibold text-neutral-700">Revisa el equipo completo o escríbenos: te ayudamos a encontrar a alguien.</p>
      )}

      {resultado.otros.length > 0 && (
        <details className="group rounded-lg border border-divider bg-neutral-100 px-5 py-4">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-black tracking-[-0.02em]">
            Otras opciones del equipo ({resultado.otros.length})
            <Icon name="expand_more" className="transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {resultado.otros.map((o) => (
              <TarjetaResultado key={o.perfil.id} opcion={o} agenda={agenda} />
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/equipo" variant="secondary" icon="group">
          Ver todo el equipo
        </ButtonLink>
        <Button variant="ghost" icon="restart_alt" onClick={onReiniciar}>
          Repetir el match
        </Button>
      </div>
    </div>
  );
}

function TarjetaResultado({ opcion: o, agenda, destacada = false }: { opcion: Opcion; agenda: boolean; destacada?: boolean }) {
  const p = o.perfil;
  const tarifa = textoTarifa(p);
  return (
    <article
      className={`rounded-lg p-[clamp(18px,3vw,26px)] ${destacada ? 'border-[1.5px] border-accent-500 bg-bg shadow-lg' : 'border border-divider bg-bg'}`}
    >
      <div className="mb-4 flex flex-wrap items-start gap-[18px]">
        <AvatarProfesional nombre={nombrePerfil(p)} foto={p.foto_url} size={destacada ? 96 : 64} />
        <div className="min-w-[200px] flex-1">
          {destacada && (
            <span className="mb-2.5 inline-flex items-center gap-[7px] rounded-full bg-accent-700 px-[13px] py-[5px] text-[11px] font-extrabold tracking-[0.08em] text-neutral-100 uppercase">
              <Icon name="star" size={15} className="[font-variation-settings:'FILL'_1]" />
              Mejor match
            </span>
          )}
          <h2 className={`m-0 mb-1.5 leading-[1.05] font-black tracking-[-0.03em] ${destacada ? 'text-[clamp(22px,2.8vw,28px)]' : 'text-lg'}`}>
            {nombrePerfil(p)}
          </h2>
          <p className="m-0 text-[14px] font-bold text-neutral-700">
            {p.especialidad}
            {tarifa && ` · ${tarifa}`}
          </p>
        </div>
      </div>
      {o.razones.length > 0 && (
        <div className="mb-3.5 rounded-[18px] border border-accent-500 bg-accent-100 px-[19px] py-[15px]">
          <div className="mb-1.5 text-[10.5px] font-extrabold tracking-[0.1em] text-accent-700 uppercase">Por qué te lo sugerimos</div>
          <p className="m-0 text-[14.5px] leading-normal font-semibold text-pretty text-accent-900">{frase(o.razones)}</p>
        </div>
      )}
      {o.advertencia && (
        <p className="m-0 mb-3.5 flex gap-3 rounded-[18px] border border-neutral-500 bg-neutral-100 px-[18px] py-3.5 text-[13.5px] font-bold text-pretty text-neutral-800">
          <Icon name="info" size={19} />
          {o.advertencia}
        </p>
      )}
      {o.primerHueco && (
        <p className="m-0 mb-4 flex items-center gap-2 text-[13.5px] font-extrabold text-accent-2-800">
          <Icon name="event_available" size={18} />
          Tiene horas libres en tus horarios desde el {formatoFechaLarga(o.primerHueco)}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        {agenda && (
          <ButtonLink href={`/pedir-hora/${p.id}`} variant="team" size={destacada ? 'lg' : 'md'} icon="calendar_month" className="flex-auto">
            Pedir hora con {nombreCorto(p)}
          </ButtonLink>
        )}
        <ButtonLink href={`/equipo/${p.id}`} variant="secondary" size={destacada ? 'lg' : 'md'} icon="arrow_forward">
          Ver perfil
        </ButtonLink>
      </div>
    </article>
  );
}
