'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/**
 * Codigos de respaldo (03b-4.1): se muestran una sola vez al activar la
 * verificacion en dos pasos (o al pedir nuevos). Copiar o descargar como
 * texto; no se guardan en el navegador.
 */
export function CodigosRespaldo({
  codigos,
  onListo,
  textoListo = 'Ya los guardé, continuar',
}: {
  codigos: string[];
  onListo?: () => void;
  textoListo?: string;
}) {
  const [copiados, setCopiados] = useState(false);
  const texto = `Códigos de respaldo (cada uno sirve una sola vez):\n\n${codigos.join('\n')}\n`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiados(true);
    } catch {
      setCopiados(false);
    }
  };
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'codigos-de-respaldo.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 flex gap-2.5 rounded-[18px] border border-accent-500 bg-accent-100 px-4 py-3 text-[13.5px] font-bold text-pretty text-accent-900">
        <Icon name="key" size={19} />
        Guárdalos en un lugar seguro. Si no puedes recibir el código por correo, cada uno de estos te deja entrar una vez. No los volveremos a mostrar.
      </p>
      <ol aria-label="Códigos de respaldo" className="m-0 grid list-none grid-cols-2 gap-2 p-0">
        {codigos.map((c) => (
          <li
            key={c}
            className="rounded-[12px] border border-divider bg-bg px-3 py-2 text-center font-mono text-[14.5px] font-bold tracking-wider tabular-nums select-all"
          >
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" icon={copiados ? 'check' : 'content_copy'} onClick={() => void copiar()}>
          {copiados ? 'Copiados' : 'Copiar'}
        </Button>
        <Button variant="secondary" icon="download" onClick={descargar}>
          Descargar
        </Button>
      </div>
      {onListo && (
        <Button size="lg" variant="team" onClick={onListo} className="w-full">
          {textoListo}
        </Button>
      )}
    </div>
  );
}
