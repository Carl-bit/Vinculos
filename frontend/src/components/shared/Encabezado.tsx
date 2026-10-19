import type { ReactNode } from 'react';

import { Eyebrow } from '@/components/ui/Eyebrow';

/**
 * Encabezado de pagina del diseño (sobretitulo con linea, h1 en 900 y bajada
 * de 16.5 px). Verde en el portal, terracota en el backoffice.
 */
export function Encabezado({
  sobretitulo,
  titulo,
  bajada,
  tono = 'patient',
  accion,
}: {
  sobretitulo?: string;
  titulo: ReactNode;
  bajada?: ReactNode;
  tono?: 'patient' | 'team';
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-[clamp(16px,3vw,32px)] pb-[26px]">
      <div className="max-w-[640px]">
        {sobretitulo && <Eyebrow tone={tono}>{sobretitulo}</Eyebrow>}
        <h1 className="m-0 mb-3 text-[clamp(30px,4vw,44px)] leading-none font-black tracking-[-0.035em] text-balance">{titulo}</h1>
        {bajada && <p className="m-0 text-[16px] leading-relaxed text-pretty text-neutral-800">{bajada}</p>}
      </div>
      {accion}
    </div>
  );
}
