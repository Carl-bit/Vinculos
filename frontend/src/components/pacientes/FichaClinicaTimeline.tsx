'use client';

import { useEffect, useRef, useState } from 'react';

import { ComentariosSupervision } from '@/components/shared/ComentariosSupervision';
import { NotasClinicas } from '@/components/shared/NotasClinicas';
import { ValoresPlantilla } from '@/components/shared/ValoresPlantilla';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { correccionesDe, NIVEL_RIESGO, type BorradorVista, type EvolucionVista } from '@/lib/fichas';
import { formatoFecha, formatoFechaLarga } from '@/lib/formato';
import { separarNotas, textoPlano } from '@/lib/notasEvolucion';
import type { CitaVista } from '@/lib/panel';

type Filtro = 'todas' | 'riesgo' | 'corregidas';

interface Tarjeta {
  id: string;
  fecha: string;
  sesion: string;
  titulo: string;
  extracto: string;
  estado: 'Borrador' | 'Confirmada' | 'Corregida' | 'Corrección';
  evolucion?: EvolucionVista;
  borrador?: BorradorVista;
}

export interface Pila {
  id: string;
  titulo: string;
  sub: string;
  tarjetas: Tarjeta[];
}

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'riesgo', etiqueta: 'Con riesgo' },
  { valor: 'corregidas', etiqueta: 'Corregidas' },
];
const TONOS = [
  ['bg-accent-200', 'bg-accent-300'],
  ['bg-accent-2-200', 'bg-accent-2-300'],
  ['bg-surface', 'bg-neutral-300'],
  ['bg-accent-100', 'bg-accent-200'],
] as const;
const mes = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', month: 'long', year: 'numeric' });
const pestana = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short' });
const claveMes = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 7);
const nombreMes = (iso: string) =>
  mes
    .format(new Date(iso))
    .replace(' de ', ' ')
    .replace(/^./, (c) => c.toUpperCase());

/**
 * Pilas del archivo: borradores propios y evoluciones por mes de la sesion
 * (sin sesion asociada, por fecha de registro), de la mas reciente a la mas
 * antigua. El filtro no alcanza a los borradores: no estan en el expediente.
 */
export function armarPilas(
  evoluciones: readonly EvolucionVista[],
  borradores: readonly BorradorVista[],
  citas: readonly CitaVista[],
  filtro: Filtro,
  ahora = Date.now(),
): Pila[] {
  const corregidas = correccionesDe(evoluciones);
  const realizadas = citas.filter((c) => c.estado === 'CONFIRMADA' && new Date(c.fin).getTime() <= ahora).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const numero = new Map(realizadas.map((c, i) => [c.id, i + 1]));
  const inicioCita = new Map(citas.map((c) => [c.id, c.inicio]));

  const tarjetas = evoluciones
    .filter((e) => {
      if (filtro === 'riesgo') return !!e.nivelRiesgo && e.nivelRiesgo !== 'NINGUNO';
      if (filtro === 'corregidas') return corregidas.has(e.id) || !!e.corrigeAId;
      return true;
    })
    .map((e): Tarjeta => {
      const n = e.citaId ? numero.get(e.citaId) : undefined;
      return {
        id: e.id,
        fecha: (e.citaId && inicioCita.get(e.citaId)) || e.createdAt,
        sesion: n ? `Sesión ${n}` : (e.tipoSesion?.nombre ?? 'Evolución'),
        titulo: separarNotas(e.notas ?? '').titulo || e.tipoSesion?.nombre || 'Evolución',
        extracto: textoPlano(e.notas ?? ''),
        estado: e.corrigeAId ? 'Corrección' : corregidas.has(e.id) ? 'Corregida' : 'Confirmada',
        evolucion: e,
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  const meses = new Map<string, Tarjeta[]>();
  for (const t of tarjetas) meses.set(claveMes(t.fecha), [...(meses.get(claveMes(t.fecha)) ?? []), t]);
  const pilas: Pila[] = [...meses].map(([id, lista]) => ({
    id,
    titulo: nombreMes(lista[0]!.fecha),
    sub: lista.length === 1 ? '1 evolución' : `${lista.length} evoluciones`,
    tarjetas: lista,
  }));
  if (borradores.length > 0 && filtro === 'todas') {
    pilas.unshift({
      id: 'borradores',
      titulo: 'Borradores',
      sub: 'Solo los ves tú',
      tarjetas: borradores.map((b) => ({
        id: b.id,
        fecha: b.actualizadoEn,
        sesion: 'Sin confirmar',
        titulo: separarNotas(b.contenido).titulo || 'Sin título',
        extracto: textoPlano(b.contenido),
        estado: 'Borrador',
        borrador: b,
      })),
    });
  }
  return pilas;
}

/**
 * Archivo de evoluciones (diseño "Evoluciones: editor y archivo"), append-only:
 * pilas que se despliegan en abanico. Una correccion es un registro nuevo que
 * apunta al corregido: ambos se conservan, enlazados en "Ver versiones". En
 * pantallas chicas la pila abierta es una lista: el abanico no cabe.
 */
export function FichaClinicaTimeline({
  evoluciones,
  borradores,
  citas,
  miId,
  onCorregir,
  onContinuar,
  conSupervision = false,
  pila,
  onPila,
  editorAbierto,
}: {
  evoluciones: readonly EvolucionVista[];
  borradores: readonly BorradorVista[];
  citas: readonly CitaVista[];
  miId: string | undefined;
  onCorregir: (e: EvolucionVista) => void;
  onContinuar: (b: BorradorVista) => void;
  /** Practicante: muestra los comentarios del supervisor bajo cada evolucion. */
  conSupervision?: boolean;
  /** Pila desplegada: undefined = la del mes mas reciente; null = ninguna. */
  pila: string | null | undefined;
  onPila: (id: string | null) => void;
  editorAbierto: boolean;
}) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [asomada, setAsomada] = useState<string | null>(null);
  const [encima, setEncima] = useState<string | null>(null);
  const [versiones, setVersiones] = useState(false);
  // La evolucion elegida se abre sobre las pilas: la pantalla sube con ella hasta el documento.
  const lectura = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!seleccion) return;
    const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    lectura.current?.scrollIntoView?.({ block: 'start', behavior: sinMovimiento ? 'auto' : 'smooth' });
    lectura.current?.focus({ preventScroll: true });
  }, [seleccion]);

  const pilas = armarPilas(evoluciones, borradores, citas, filtro);
  const abierta = pila === undefined ? (pilas.find((p) => p.id !== 'borradores')?.id ?? pilas[0]?.id ?? null) : pila;
  const ordenadas = [...pilas].sort((a, b) => Number(b.id === abierta) - Number(a.id === abierta));
  const leida = pilas.flatMap((p) => p.tarjetas).find((t) => t.id === seleccion);

  const elegir = (id: string) => {
    onPila(pilas.find((p) => p.tarjetas.some((t) => t.id === id))?.id ?? null);
    setSeleccion(id);
    setVersiones(false);
  };
  const pulsar = (p: Pila, t: Tarjeta) => {
    if (p.id !== abierta) {
      onPila(p.id);
      setSeleccion(null);
    } else if (t.borrador) {
      if (!editorAbierto) onContinuar(t.borrador);
    } else {
      setSeleccion(t.id);
      setVersiones(false);
    }
  };

  return (
    <section aria-labelledby="titulo-archivo" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="titulo-archivo" className="m-0 text-[24px] font-black">
          Evoluciones guardadas
        </h2>
        <span className="text-[13px] font-semibold text-neutral-700">Toca una pila para desplegarla en abanico</span>
        <div role="group" aria-label="Filtrar" className="ml-auto flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => {
                setFiltro(f.valor);
                setSeleccion(null);
                onPila(null);
              }}
              className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-[13px] font-bold ${
                filtro === f.valor ? 'border-neutral-900 bg-neutral-900 text-neutral-100' : 'border-divider bg-surface hover:border-accent-500'
              }`}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {leida?.evolucion && (
        <div ref={lectura} tabIndex={-1} className="scroll-mt-4 outline-none">
          <LecturaEvolucion
            tarjeta={leida}
            evolucion={leida.evolucion}
            evoluciones={evoluciones}
            miId={miId}
            conSupervision={conSupervision}
            versiones={versiones}
            onVersiones={() => setVersiones((v) => !v)}
            onElegir={elegir}
            onCorregir={onCorregir}
            onCerrar={() => setSeleccion(null)}
          />
        </div>
      )}

      {pilas.length === 0 ? (
        <p className="m-0 rounded-lg border border-divider bg-neutral-100 px-4 py-6 text-center text-[14px] font-semibold text-neutral-800">
          {filtro === 'todas' ? 'Todavía no hay evoluciones registradas' : 'No hay evoluciones con este filtro'}
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 min-[1800px]:grid-cols-3">
          {ordenadas.map((p) => {
            const desplegada = p.id === abierta;
            const borrador = p.id === 'borradores';
            return (
              <div
                key={p.id}
                data-testid="pila"
                onMouseEnter={() => setAsomada(p.id)}
                onMouseLeave={() => setAsomada(null)}
                className={`flex flex-col gap-1 rounded-[20px] border border-divider px-5 pt-[18px] transition-colors duration-300 motion-reduce:transition-none ${
                  desplegada ? 'col-span-full bg-neutral-100 max-sm:pb-5' : 'bg-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[18px] font-extrabold">{p.titulo}</span>
                    <span className="text-[12px] font-semibold text-neutral-700">{p.sub}</span>
                  </div>
                  <button
                    type="button"
                    aria-expanded={desplegada}
                    onClick={() => {
                      onPila(desplegada ? null : p.id);
                      setSeleccion(null);
                    }}
                    className="ml-auto min-h-10 cursor-pointer rounded-full border border-divider bg-neutral-100 px-3.5 text-[13px] font-bold hover:border-accent-500"
                  >
                    {desplegada ? 'Juntar' : 'Desplegar'}
                  </button>
                </div>
                <div
                  className={`relative [container-type:inline-size] transition-[height] duration-[400ms] motion-reduce:transition-none ${
                    desplegada ? 'h-[310px] max-sm:flex max-sm:h-auto max-sm:flex-col max-sm:gap-7 max-sm:pt-7' : 'h-[270px]'
                  }`}
                >
                  {p.tarjetas.map((t, i) => (
                    <TarjetaPila
                      key={t.id}
                      tarjeta={t}
                      indice={i}
                      total={p.tarjetas.length}
                      vista={desplegada ? 'abierta' : asomada === p.id ? 'asomada' : 'junta'}
                      borrador={borrador}
                      seleccionada={seleccion === t.id}
                      encima={desplegada && encima === t.id}
                      bloqueada={borrador && desplegada && editorAbierto}
                      onEncima={setEncima}
                      onPulsar={() => pulsar(p, t)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TarjetaPila({
  tarjeta: t,
  indice: i,
  total,
  vista,
  borrador,
  seleccionada,
  encima,
  bloqueada,
  onEncima,
  onPulsar,
}: {
  tarjeta: Tarjeta;
  indice: number;
  total: number;
  vista: 'abierta' | 'asomada' | 'junta';
  borrador: boolean;
  seleccionada: boolean;
  encima: boolean;
  bloqueada: boolean;
  onEncima: (id: string | null) => void;
  onPulsar: () => void;
}) {
  const medio = (total - 1) / 2;
  const d = i - medio;
  // El paso del abanico se achica para que quepan todas las tarjetas en el ancho de la pila.
  const paso = `min(175px, (100cqw - 300px) / ${Math.max(total - 1, 1)})`;
  // Con muchas tarjetas se abre menos: los extremos no se salen de la pila.
  const giro = Math.min(5, 9 / Math.max(medio, 1));
  const caida = Math.min(16, 32 / Math.max(medio, 1));
  let transform = `translate(${i * 7}px, ${-i * 7}px) rotate(${d * 1.5}deg)`;
  if (vista === 'asomada') transform = `translate(${i * 22}px, ${-i * 12}px) rotate(${d * 4}deg)`;
  if (vista === 'abierta') {
    const alza = (seleccionada ? -18 : 0) + (encima ? -26 : 0);
    transform = `translate(calc(${d} * ${paso}), ${Math.abs(d) * caida + alza}px) rotate(${encima ? d * 2 : d * giro}deg) scale(${encima ? 1.05 : 1})`;
  }
  const tono = TONOS[i % TONOS.length]!;
  const lista = vista === 'abierta';
  const riesgo = t.evolucion?.nivelRiesgo;
  return (
    <button
      type="button"
      aria-label={`${t.titulo}, ${formatoFecha(t.fecha)}${bloqueada ? '. Cierra el editor para continuar este borrador' : ''}`}
      aria-disabled={bloqueada}
      onClick={onPulsar}
      onMouseEnter={() => onEncima(t.id)}
      onMouseLeave={() => onEncima(null)}
      onFocus={() => onEncima(t.id)}
      onBlur={() => onEncima(null)}
      style={{ transform, zIndex: seleccionada ? 50 : encima ? 40 : total - i, transformOrigin: '50% 120%' }}
      className={`absolute top-11 left-[calc(50%-120px)] h-[200px] w-[240px] cursor-pointer bg-transparent p-0 text-left transition-transform duration-[480ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${
        lista ? 'max-sm:!relative max-sm:!top-0 max-sm:!left-0 max-sm:!w-full max-sm:!transform-none' : ''
      }`}
    >
      <span
        className={`absolute -top-5 left-0 h-6 rounded-t-[10px] px-3.5 text-[11px] leading-6 font-bold tracking-[0.06em] uppercase ${borrador ? 'bg-surface' : tono[1]}`}
      >
        {pestana.format(new Date(t.fecha)).replace('.', '')}
      </span>
      <span
        className={`absolute inset-0 flex flex-col gap-2 rounded-tr-[14px] rounded-b-[14px] p-4 ${
          borrador ? 'border-2 border-dashed border-neutral-500 bg-neutral-100' : `border border-divider ${tono[0]}`
        } ${seleccionada || encima ? 'shadow-lg' : 'shadow-md'}`}
      >
        <span className="text-[11px] font-semibold text-neutral-800">{t.sesion}</span>
        <span className="line-clamp-2 text-[16px] leading-[1.25] font-extrabold">{t.titulo}</span>
        <span className="line-clamp-3 text-[13px] leading-[1.45] font-medium text-neutral-800">{t.extracto}</span>
        <span className="mt-auto flex flex-wrap gap-1.5">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-bold">{t.estado}</span>
          {(riesgo === 'MEDIO' || riesgo === 'ALTO') && (
            <span className="rounded-full bg-accent-800 px-2 py-0.5 text-[11px] font-bold text-neutral-100">{NIVEL_RIESGO[riesgo].texto}</span>
          )}
        </span>
      </span>
    </button>
  );
}

/** Original y correcciones de un registro, del mas antiguo al mas nuevo. */
function cadenaDe(e: EvolucionVista, evoluciones: readonly EvolucionVista[]): EvolucionVista[] {
  const porId = new Map(evoluciones.map((x) => [x.id, x]));
  const corregidas = correccionesDe(evoluciones);
  let raiz = e;
  while (raiz.corrigeAId && porId.has(raiz.corrigeAId)) raiz = porId.get(raiz.corrigeAId)!;
  const cadena = [raiz];
  while (corregidas.has(cadena[cadena.length - 1]!.id)) cadena.push(corregidas.get(cadena[cadena.length - 1]!.id)!);
  return cadena;
}

function LecturaEvolucion({
  tarjeta,
  evolucion: e,
  evoluciones,
  miId,
  conSupervision,
  versiones,
  onVersiones,
  onElegir,
  onCorregir,
  onCerrar,
}: {
  tarjeta: Tarjeta;
  evolucion: EvolucionVista;
  evoluciones: readonly EvolucionVista[];
  miId: string | undefined;
  conSupervision: boolean;
  versiones: boolean;
  onVersiones: () => void;
  onElegir: (id: string) => void;
  onCorregir: (e: EvolucionVista) => void;
  onCerrar: () => void;
}) {
  const riesgo = e.nivelRiesgo ? NIVEL_RIESGO[e.nivelRiesgo] : undefined;
  const cadena = cadenaDe(e, evoluciones);
  const vigente = cadena[cadena.length - 1]!.id === e.id;
  const registro = e.copiaAutoria.registro && e.copiaAutoria.registro !== 'sin registro' ? ` · Reg. ${e.copiaAutoria.registro}` : '';
  return (
    <article
      aria-labelledby="titulo-lectura"
      className="flex max-w-[860px] flex-col gap-3.5 rounded-[18px] border border-divider bg-neutral-100 px-[clamp(18px,4vw,48px)] py-8 shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-neutral-700">
          {tarjeta.sesion} · {formatoFechaLarga(tarjeta.fecha)} · {e.copiaAutoria.nombre ?? 'Autor'}
          {registro}
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {riesgo && <Badge tono={riesgo.tono}>{riesgo.texto}</Badge>}
          <Badge tono="neutro">{tarjeta.estado}</Badge>
        </span>
      </div>
      <h3 id="titulo-lectura" className="m-0 text-[28px] leading-[1.2] font-black">
        {tarjeta.titulo}
      </h3>
      {(e.estadoAvance || e.intervenciones.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {e.estadoAvance && <Badge>Avance: {e.estadoAvance.nombre}</Badge>}
          {e.intervenciones.map((i) => (
            <Badge key={i.id}>{i.nombre}</Badge>
          ))}
        </div>
      )}
      {e.notas && <NotasClinicas notas={e.notas} />}
      {e.plantilla && (
        <div className="border-t border-divider pt-3">
          <p className="m-0 mb-2.5 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">
            {e.plantilla.nombre} · versión {e.plantilla.version}
          </p>
          <ValoresPlantilla campos={e.plantilla.definicion} valores={e.valores as Record<string, string> | null} />
        </div>
      )}
      {conSupervision && <ComentariosSupervision evolucionId={e.id} puedeComentar={false} />}
      {versiones && (
        <ol aria-label="Versiones de este registro" className="m-0 flex list-none flex-col gap-1.5 border-t border-divider p-0 pt-3">
          {cadena.map((v, i) => (
            <li key={v.id}>
              <button
                type="button"
                aria-current={v.id === e.id}
                onClick={() => onElegir(v.id)}
                className="flex min-h-9 cursor-pointer items-center gap-1.5 text-[13px] font-extrabold text-accent-700 hover:text-accent-800"
              >
                <Icon name="history" size={16} />
                {i === 0 ? 'Original' : `Corrección ${i}`} · {formatoFechaLarga(v.createdAt)}
                {v.id === e.id ? ' (la que estás leyendo)' : ''}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2.5 border-t border-divider pt-3.5">
        {miId === e.autorId && vigente && (
          <Button variant="team" icon="edit_note" onClick={() => onCorregir(e)}>
            Corregir
          </Button>
        )}
        {cadena.length > 1 && (
          <Button variant="secondary" icon="history" onClick={onVersiones}>
            Ver versiones
          </Button>
        )}
        <Button variant="secondary" onClick={onCerrar}>
          Volver a la pila
        </Button>
      </div>
    </article>
  );
}
