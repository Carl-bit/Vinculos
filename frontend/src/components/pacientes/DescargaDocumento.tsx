'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { descargarArchivo } from '@/lib/descargas';

/**
 * Destino del enlace del documento por correo (con sesion). La descarga se
 * registra en la API al presionar el boton (un escaner de correo no la
 * cuenta). El PDF se genera en el servidor; aqui solo se guarda.
 */
export function DescargaDocumento() {
  const token = useSearchParams().get('token') ?? '';
  const [estado, setEstado] = useState<'listo' | 'vencido' | 'error' | null>(null);
  const [cargando, setCargando] = useState(false);

  const descargar = async () => {
    setCargando(true);
    const r = await descargarArchivo(`/api/documentos-clinicos/descarga/${encodeURIComponent(token)}`, 'documento.pdf');
    setEstado(r === 'no-encontrado' ? 'vencido' : r);
    setCargando(false);
  };

  return (
    <div className="entrada max-w-[600px] py-[clamp(24px,5vw,56px)]">
      <span className="mb-6 grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
        <Icon name={estado === 'vencido' ? 'link_off' : estado === 'listo' ? 'task_alt' : 'picture_as_pdf'} size={30} />
      </span>
      {estado === 'vencido' ? (
        <>
          <h1 className="m-0 mb-3.5 text-[clamp(28px,4vw,40px)] leading-[1.02] font-black tracking-[-0.035em]">Este enlace ya no sirve</h1>
          <p className="m-0 mb-6 text-[16px] leading-relaxed text-neutral-700">
            Los enlaces de documentos vencen por seguridad. Pide a tu profesional que te lo envíe de nuevo.
          </p>
          <ButtonLink href="/portal/documentos" variant="secondary" icon="description">
            Ver mis documentos
          </ButtonLink>
        </>
      ) : (
        <>
          <h1 className="m-0 mb-3.5 text-[clamp(28px,4vw,40px)] leading-[1.02] font-black tracking-[-0.035em]">
            {estado === 'listo' ? 'Descargamos tu documento' : 'Tu documento está listo'}
          </h1>
          <p className="m-0 mb-6 text-[16px] leading-relaxed text-neutral-700">
            {estado === 'listo'
              ? 'Revisa la carpeta de descargas de tu equipo. Guárdalo en un lugar seguro: contiene información de salud.'
              : 'Presiona el botón para descargar el PDF. La descarga queda registrada en tu ficha.'}
          </p>
          {estado === 'error' && (
            <p role="alert" className="m-0 mb-4 text-[14px] font-bold text-accent-700">
              No pudimos descargar el documento. Intenta de nuevo en unos minutos.
            </p>
          )}
          <Button size="lg" icon="download" loading={cargando} onClick={() => void descargar()} disabled={!token}>
            {estado === 'listo' ? 'Descargar de nuevo' : 'Descargar PDF'}
          </Button>
        </>
      )}
    </div>
  );
}
