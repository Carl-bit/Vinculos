'use client';

import { EstadoVista } from '@/components/shared/EstadoVista';
import { ButtonLink } from '@/components/ui/ButtonLink';
import type { Rol } from '@/lib/sesion';

import { DetallePaciente } from './DetallePaciente';
import { RielPacientes } from './RielPacientes';

/**
 * Fichas del profesional y del practicante (diseño "Profesional flujo del
 * dia y ficha completa"): riel "Mis pacientes" a la izquierda y la ficha
 * completa del paciente elegido a la derecha. Al entrar no hay ninguna ficha
 * abierta: se elige un paciente del riel, y tocarlo otra vez (o "Cerrar
 * ficha") la cierra.
 */
export function FichasProfesional({ rol, seleccionado }: { rol: Rol; seleccionado?: string }) {
  return (
    <div className="flex flex-wrap items-start gap-4 pt-[clamp(12px,2vw,20px)]">
      <RielPacientes rol={rol} seleccionado={seleccionado} />
      <div className="min-w-0 flex-[999_1_620px]">
        {seleccionado ? (
          <>
            <div className="mb-2 flex justify-end">
              <ButtonLink href="/admin/fichas" variant="ghost" icon="close" className="!px-3.5 !py-2 !text-[13px]">
                Cerrar ficha
              </ButtonLink>
            </div>
            <DetallePaciente id={seleccionado} rol={rol} embebido />
          </>
        ) : (
          <div className="rounded-md border border-dashed border-neutral-400 bg-neutral-100">
            <EstadoVista
              estado="vacio"
              titulo="No has seleccionado ningún paciente"
              mensaje="Elige uno en «Mis pacientes»: Hoy, Por hacer o Todos. Su ficha se abre aquí y la cierras tocándolo otra vez."
            />
          </div>
        )}
      </div>
    </div>
  );
}
