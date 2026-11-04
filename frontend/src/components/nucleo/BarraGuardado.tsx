'use client';

import { Button } from '@/components/ui/Button';

/**
 * Barra fija al pie de una seccion de Configuracion (diseño "Opcion A submenu
 * agrupado"): estado o aviso de auditoria, "Descartar" (vuelve a lo guardado)
 * y "Guardar esta seccion". `enviar` omitido = el boton es submit del form.
 */
export function BarraGuardado({
  seccion,
  error,
  guardado,
  cambiado,
  guardando,
  onDescartar,
  onGuardar,
}: {
  seccion: string;
  error?: string;
  guardado: boolean;
  cambiado: boolean;
  guardando: boolean;
  onDescartar: () => void;
  onGuardar?: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-[16px] border border-divider bg-surface/95 px-[18px] py-3.5 shadow-md">
      {error ? (
        <p role="alert" className="m-0 min-w-0 flex-1 basis-60 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      ) : guardado ? (
        <p role="status" className="m-0 min-w-0 flex-1 basis-60 text-[13px] font-bold text-accent-2-800">
          Cambios guardados.
        </p>
      ) : (
        <p className="m-0 min-w-0 flex-1 basis-60 text-[13px] font-semibold text-neutral-800">
          Los cambios de «{seccion}» se guardan juntos y quedan en la auditoría.
        </p>
      )}
      <div className="ml-auto flex gap-3">
        <Button variant="secondary" disabled={!cambiado || guardando} onClick={onDescartar}>
          Descartar
        </Button>
        <Button type={onGuardar ? 'button' : 'submit'} variant="team" icon="save" loading={guardando} onClick={onGuardar}>
          Guardar esta sección
        </Button>
      </div>
    </div>
  );
}
