'use client';

import { useEffect, useState } from 'react';

import { restante } from '@/lib/horarios';

/**
 * Anillo con el tiempo que queda de la retencion de la hora. El texto visible
 * cambia cada segundo; al lector de pantalla se le anuncia solo cada minuto
 * (WCAG 2.2.1: avisar del limite sin saturar).
 */
export function CuentaRegresiva({ desde, hasta, onVencida }: { desde: Date; hasta: Date; onVencida: () => void }) {
  const [ahora, setAhora] = useState(() => new Date());
  const { ms, texto } = restante(hasta, ahora);
  const total = Math.max(1, hasta.getTime() - desde.getTime());
  const minutos = Math.ceil(ms / 60_000);

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (ms === 0) onVencida();
  }, [ms, onVencida]);

  const r = 52;
  const perimetro = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <svg width="124" height="124" viewBox="0 0 124 124" aria-hidden="true" className="flex-none -rotate-90">
        <circle cx="62" cy="62" r={r} fill="none" strokeWidth="8" className="stroke-neutral-300" />
        <circle
          cx="62"
          cy="62"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={perimetro}
          strokeDashoffset={perimetro * (1 - ms / total)}
          className={`transition-[stroke-dashoffset] duration-1000 ease-linear ${minutos <= 5 ? 'stroke-accent-700' : 'stroke-accent-2-600'}`}
        />
      </svg>
      <div>
        <div className="text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">Tu hora está retenida</div>
        <div className="text-[40px] leading-none font-black tracking-[-0.04em] tabular-nums" aria-hidden="true">
          {texto}
        </div>
        <p className="sr-only" aria-live="polite">
          {ms === 0 ? 'La retención terminó.' : `Quedan ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} para confirmar.`}
        </p>
      </div>
    </div>
  );
}
