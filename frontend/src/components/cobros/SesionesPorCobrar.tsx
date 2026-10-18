'use client';

import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pestanas } from '@/components/ui/Pestanas';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { ESTADO_PAGO, useEstadosCobro, type EstadoPagoCitaVista, type Periodo } from '@/lib/cobros';
import { useMiCuenta } from '@/lib/consultas';
import { formatoClp, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { nombresPacientes, useEquipoAgenda, usePacientes } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { RegistrarAsistenciaPago } from './RegistrarAsistenciaPago';

type Filtro = 'por-cobrar' | 'canceladas' | 'todas';

/**
 * Sesiones del periodo con su estado de pago. "Por cobrar": ya ocurridas con
 * saldo (o sin decidir la asistencia); "Canceladas": por resolver (devolucion
 * o traslado). Cada fila abre "Registrar asistencia y pago".
 */
export function SesionesPorCobrar({ periodo, rol }: { periodo: Periodo; rol: Rol }) {
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const cuenta = useMiCuenta();
  const estados = useEstadosCobro(periodo, admin ? (profesionalId ?? undefined) : cuenta.data?.id);
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const [filtro, setFiltro] = useState<Filtro>('por-cobrar');
  const [abierta, setAbierta] = useState<EstadoPagoCitaVista | null>(null);
  const ahora = Date.now();

  const visibles = (estados.data ?? []).filter((c) => {
    if (filtro === 'todas') return true;
    if (filtro === 'canceladas') return c.estado_cita === 'CANCELADA' && c.pagado > 0;
    return c.estado_cita !== 'CANCELADA' && new Date(c.fin).getTime() < ahora && c.saldo > 0;
  });

  return (
    <div className="flex flex-col gap-4">
      <Pestanas
        etiqueta="Filtrar sesiones"
        tono="team"
        valor={filtro}
        onChange={setFiltro}
        pestanas={[
          { valor: 'por-cobrar', etiqueta: 'Por cobrar' },
          { valor: 'canceladas', etiqueta: 'Canceladas con pago' },
          { valor: 'todas', etiqueta: 'Todas' },
        ]}
      />
      <EstadoConsulta
        consulta={estados}
        vacio={() => visibles.length === 0}
        textoVacio={filtro === 'por-cobrar' ? 'No hay sesiones por cobrar en el período' : 'Nada en este filtro'}
      >
        {() => (
          <Tabla etiqueta="Sesiones del período">
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Profesional</Th>
                <Th>Fecha</Th>
                <Th className="text-right">Saldo</Th>
                <Th>Estado</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const e = ESTADO_PAGO[c.estado_pago];
                return (
                  <tr key={c.cita_id} className="transition-colors duration-200 hover:bg-accent-100">
                    <Td className="font-extrabold">{nombres.get(c.paciente_id) ?? 'Paciente'}</Td>
                    <Td className="font-semibold">{profesional.get(c.profesional_id) ?? 'Profesional'}</Td>
                    <Td className="font-semibold text-neutral-800 first-letter:uppercase">
                      {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)}
                    </Td>
                    <Td className="text-right font-bold tabular-nums">{formatoClp(c.saldo)}</Td>
                    <Td>
                      <Badge tono={c.estado_cita === 'CANCELADA' ? 'neutro' : e.tono}>{c.estado_cita === 'CANCELADA' ? 'Cancelada' : e.texto}</Badge>
                    </Td>
                    <Td className="text-right">
                      <Button variant="ghost" icon="task_alt" onClick={() => setAbierta(c)} className="!px-3.5 !py-2 !text-[12.5px] whitespace-nowrap">
                        {c.estado_cita === 'CANCELADA' ? 'Resolver' : 'Asistencia y pago'}
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
        )}
      </EstadoConsulta>
      <RegistrarAsistenciaPago
        citaId={abierta?.cita_id ?? null}
        nombrePaciente={abierta ? (nombres.get(abierta.paciente_id) ?? 'Paciente') : ''}
        nombreProfesional={abierta ? (profesional.get(abierta.profesional_id) ?? 'Profesional') : ''}
        rol={rol}
        onCerrar={() => setAbierta(null)}
      />
    </div>
  );
}
