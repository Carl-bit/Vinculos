'use client';

import { Aviso } from '@/components/ui/Aviso';
import { useModulos } from '@/lib/consultas';

/** "2026-12-31" -> "31-12-2026" (sin zona horaria: es una fecha de calendario). */
const fechaChile = (iso: string) => iso.split('-').reverse().join('-');

/**
 * R12: el centro esta saliendo de Vinculos y la plataforma quedo en solo
 * lectura. Se puede ver, exportar, ejercer derechos y cuidar la cuenta propia;
 * lo demas lo rechaza la API (423).
 */
export function AvisoSoloLectura() {
  const { data } = useModulos();
  if (!data?.soloLectura) return null;
  return (
    <Aviso tono="advertencia" icono="lock" role="status" titulo="Plataforma en solo lectura" className="mb-5">
      El centro está cerrando su cuenta en Vinculos{data.fechaCorte ? ` (fecha de corte: ${fechaChile(data.fechaCorte)})` : ''}. Puedes ver y exportar tus datos y
      ejercer tus derechos, pero no crear ni modificar información.
    </Aviso>
  );
}
