import { Eyebrow } from '@/components/ui/Eyebrow';
import { formatoFechaLarga } from '@/lib/formato';

/** Texto vigente de una politica versionada (datos, terminos, consentimiento). */
export function DocumentoPolitica({ titulo, version, vigenteDesde, texto }: { titulo: string; version: number; vigenteDesde: string; texto: string }) {
  return (
    <article className="entrada max-w-[68ch] py-[clamp(24px,4vw,48px)]">
      <Eyebrow tone="patient">Versión {version}</Eyebrow>
      <h1 className="m-0 mb-3 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{titulo}</h1>
      <p className="m-0 mb-8 text-sm font-semibold text-neutral-700">Vigente desde el {formatoFechaLarga(vigenteDesde)}.</p>
      <div className="text-base leading-[1.75] text-pretty whitespace-pre-line text-neutral-800">{texto}</div>
    </article>
  );
}
