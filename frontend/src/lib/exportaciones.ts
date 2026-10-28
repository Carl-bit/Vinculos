'use client';

/**
 * AUD-01 Fase 3: exportaciones de datos (docs/cumplimiento/exportacion.md).
 * Consultas compartidas entre el inicio (nucleo) y la ficha (pacientes).
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type ExportacionPaciente = components['schemas']['ExportacionPacienteVista'];

export const ESTADO_EXPORTACION: Record<ExportacionPaciente['estado'], string> = {
  ESPERANDO_TRATANTE: 'Esperando la parte clínica del tratante',
  LISTA: 'Lista para enviar',
  ENVIADA: 'Enviada al paciente',
  VENCIDA: 'Vencida (datos borrados)',
};

/** Exportaciones que esperan la parte clinica del profesional (solo PROFESIONAL). */
export function useExportacionesPendientes(habilitado = true) {
  return useQuery({
    queryKey: ['exportaciones', 'pendientes'],
    queryFn: () => datos(api.GET('/api/exportaciones/pendientes')),
    enabled: habilitado,
  });
}
