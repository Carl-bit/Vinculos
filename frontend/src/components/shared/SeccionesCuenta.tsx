'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Badge, type TonoBadge } from '@/components/ui/Badge';

export interface SeccionCuenta {
  id: string;
  grupo: string;
  titulo: string;
  descripcion: string;
  chip?: { texto: string; tono: TonoBadge };
  contenido: ReactNode;
}

/**
 * Mi cuenta (diseño "Mi cuenta en estilo Moderno A"): menu lateral fijo con
 * las secciones agrupadas (Mis datos, Mi trabajo, Dinero) y a la derecha la
 * seccion elegida. La seccion va en la URL (?seccion=): se puede enlazar y el
 * boton atras funciona. Cada bloque guarda con su propio boton.
 */
export function SeccionesCuenta({ secciones }: { secciones: SeccionCuenta[] }) {
  const router = useRouter();
  const ruta = usePathname();
  const parametros = useSearchParams();
  const actual = secciones.find((s) => s.id === parametros.get('seccion')) ?? secciones[0];
  if (!actual) return null;
  const grupos = [...new Set(secciones.map((s) => s.grupo))];
  const ir = (id: string) => {
    const p = new URLSearchParams(parametros);
    p.set('seccion', id);
    router.replace(`${ruta}?${p.toString()}`, { scroll: false });
  };
  return (
    <div className="mx-auto flex w-full max-w-[1140px] flex-wrap items-start gap-[22px]">
      <nav
        aria-label="Secciones de la cuenta"
        className="flex max-w-[270px] min-w-0 flex-[1_1_240px] flex-col gap-1 rounded-[24px] border border-divider bg-bg/95 p-3.5 shadow-lg backdrop-blur-[10px] lg:sticky lg:top-[84px]"
      >
        {grupos.map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <span className="px-2.5 pt-2.5 pb-1 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">{g}</span>
            {secciones
              .filter((s) => s.grupo === g)
              .map((s) => {
                const on = s.id === actual.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    onClick={() => ir(s.id)}
                    className={`flex min-h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-[14px] px-3 text-left font-extrabold transition-colors duration-200 ${
                      on ? 'bg-neutral-100 shadow-md' : 'hover:bg-neutral-200'
                    }`}
                  >
                    <span aria-hidden className={`size-2 flex-none rounded-full ${on ? 'bg-accent-700' : 'bg-neutral-400'}`} />
                    <span className="min-w-0 flex-1">{s.titulo}</span>
                    {s.chip && <Badge tono={s.chip.tono}>{s.chip.texto}</Badge>}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
        <header className="flex flex-col gap-0.5 px-1.5">
          <span className="text-[11px] font-extrabold tracking-[0.12em] text-accent-700 uppercase">{actual.grupo}</span>
          <h1 className="m-0 text-[32px] leading-[1.1] font-black tracking-[-0.03em]">{actual.titulo}</h1>
          <p className="m-0 text-[14px] font-semibold text-neutral-700">{actual.descripcion}</p>
        </header>
        <div key={actual.id} className="flex flex-col gap-4">
          {actual.contenido}
        </div>
      </div>
    </div>
  );
}
