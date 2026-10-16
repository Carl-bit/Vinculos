import type { ReactNode } from 'react';

/** Sobretitulo en mayusculas con linea inferior, repetido sobre cada h1 del diseño. */
export function Eyebrow({ children, tone = 'team' }: { children: ReactNode; tone?: 'team' | 'patient' }) {
  const color = tone === 'team' ? 'text-accent-700 border-accent-500' : 'text-accent-2-700 border-accent-2-600';
  return <div className={`mb-4 inline-flex border-b-2 pb-2.5 text-[11px] font-extrabold tracking-[0.16em] uppercase ${color}`}>{children}</div>;
}
