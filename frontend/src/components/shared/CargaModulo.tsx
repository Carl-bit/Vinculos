'use client';

import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

/** Espera tras quedar sin consultas: cubre las que arrancan despues de otra (dependientes) y el primer render. */
const ASENTADO_MS = 150;
/** Tope: si algo no termina (red lenta), se muestra igual; cada panel conserva su propio estado. */
const TOPE_MS = 10_000;

/**
 * Entrada de un modulo del panel o del portal (03b-6, estados de vista): en
 * vez de mostrar la pagina vacia y que cada panel aparezca a su tiempo, el
 * modulo se monta oculto (sus consultas ya corren y su layout se mide) bajo un
 * esqueleto de pagina completa, y se muestra de una vez cuando ninguna
 * consulta sin datos sigue en vuelo. Las consultas en cache (volver a un
 * modulo) o con polling no lo retienen. Se reinicia en cada ruta (el <main>
 * de cada layout lleva key={ruta}).
 */
export function CargaModulo({ children }: { children: ReactNode }) {
  const sinDatos = useIsFetching({ predicate: (q) => q.state.data === undefined });
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (listo) return;
    const tope = setTimeout(() => setListo(true), TOPE_MS);
    return () => clearTimeout(tope);
  }, [listo]);

  useEffect(() => {
    if (listo || sinDatos > 0) return;
    const asentado = setTimeout(() => setListo(true), ASENTADO_MS);
    return () => clearTimeout(asentado);
  }, [sinDatos, listo]);

  return (
    <div className="relative" aria-busy={!listo || undefined}>
      {!listo && <EsqueletoModulo />}
      {/* visibility y no display: el contenido se mide igual (scroll de la agenda, anchos de grilla). inert: sin foco ni lector mientras carga. */}
      <div className={listo ? 'entrada' : 'invisible'} inert={!listo || undefined}>
        {children}
      </div>
    </div>
  );
}

/** Esqueleto de pagina: encabezado, fila de cifras y dos columnas de tarjetas (la forma comun de los modulos). */
function EsqueletoModulo() {
  return (
    <div role="status" aria-live="polite" className="absolute inset-x-0 top-0 z-[1] flex flex-col gap-5">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        <span className="esqueleto h-3 w-40 rounded-full" />
        <span className="esqueleto h-9 w-72 max-w-full rounded-full" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="esqueleto h-24 rounded-tarjeta" />
        ))}
      </div>
      <div aria-hidden="true" className="grid gap-3.5 md:grid-cols-[3fr_2fr]">
        <span className="esqueleto h-72 rounded-tarjeta" />
        <span className="esqueleto h-72 rounded-tarjeta" />
      </div>
    </div>
  );
}
