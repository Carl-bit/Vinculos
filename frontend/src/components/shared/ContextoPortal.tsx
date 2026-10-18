'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { useMiCuenta } from '@/lib/consultas';
import { edadEn } from '@/lib/condiciones';
import { useMisDatos, usePacientesPortal, type PacientePortal } from '@/lib/portal';
import type { Rol } from '@/lib/sesion';

interface Portal {
  rol: Rol;
  /** Adulto responsable: actua por un menor a su cargo. */
  responsable: boolean;
  /** Paciente de 14 a 17 con cuenta propia (D-4): sus citas, recordatorios y mensajes. */
  restringida: boolean;
  /** Paciente sobre el que se muestra todo (el propio o el menor elegido). */
  pacienteId: string | undefined;
  /** Para la API: solo el adulto responsable indica pacienteId. */
  pacienteParam: string | undefined;
  pacientes: PacientePortal[];
  paciente: PacientePortal | undefined;
  elegirPaciente: (id: string) => void;
  cargando: boolean;
}

const Contexto = createContext<Portal | null>(null);

/**
 * Contexto del portal: quien es la cuenta y por que paciente actua. El menor
 * elegido por un adulto responsable vive solo en memoria (nada del paciente
 * en el almacenamiento del navegador).
 */
export function ProveedorPortal({ rol, children }: { rol: Rol; children: ReactNode }) {
  const responsable = rol === 'RESPONSABLE';
  const cuenta = useMiCuenta();
  const pacientes = usePacientesPortal();
  const [elegido, setElegido] = useState<string>();
  const propio = responsable ? undefined : (cuenta.data?.pacienteId ?? undefined);
  const pacienteId = responsable ? (elegido ?? pacientes.data?.[0]?.id) : propio;
  const datos = useMisDatos(undefined, !responsable);

  const valor = useMemo<Portal>(() => {
    const lista = pacientes.data ?? [];
    const paciente = lista.find((p) => p.id === pacienteId);
    const nacimiento = datos.data?.fechaNacimiento;
    return {
      rol,
      responsable,
      restringida: !responsable && !!nacimiento && edadEn(nacimiento) < 18,
      pacienteId,
      pacienteParam: responsable ? pacienteId : undefined,
      pacientes: lista,
      paciente,
      elegirPaciente: setElegido,
      cargando: pacientes.isPending || (!responsable && (cuenta.isPending || datos.isPending)),
    };
  }, [rol, responsable, pacienteId, pacientes.data, pacientes.isPending, cuenta.isPending, datos.data, datos.isPending]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePortal(): Portal {
  const v = useContext(Contexto);
  if (!v) throw new Error('usePortal fuera de ProveedorPortal');
  return v;
}
