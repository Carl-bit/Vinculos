'use client';

import { EstadoVista } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';

/** Error del sitio publico (API caida o respuesta inesperada). Sin detalles tecnicos. */
export default function ErrorPublico({ reset }: { reset: () => void }) {
  return (
    <EstadoVista
      estado="error"
      titulo="No pudimos cargar esta página"
      mensaje="Intenta de nuevo en unos minutos."
      accion={
        <Button variant="secondary" icon="refresh" onClick={reset}>
          Reintentar
        </Button>
      }
    />
  );
}
