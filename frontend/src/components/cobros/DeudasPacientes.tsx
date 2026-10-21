'use client';

import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { useConfiguracionCentro } from '@/lib/centro';
import { useDeudas, type DeudaPaciente } from '@/lib/cobros';
import { formatoClp, formatoFechaLarga } from '@/lib/formato';
import { nombresPacientes, useEquipoAgenda, usePacientes } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { RegistrarAsistenciaPago } from './RegistrarAsistenciaPago';

/**
 * 03b-3.3: pacientes con deuda (sesiones terminadas con saldo, pasados los
 * dias de gracia). Con el bloqueo del centro activo no agendan hasta
 * regularizar; la lista sirve tambien para pacientes sin cuenta, que no ven
 * el aviso en un portal. "Registrar pago" abre la sesion impaga mas antigua.
 */
export function DeudasPacientes({ rol }: { rol: Rol }) {
  const deudas = useDeudas();
  const configuracion = useConfiguracionCentro();
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const tratante = new Map((pacientes.data ?? []).map((p) => [p.id, p.profesionalId]));
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const [abierta, setAbierta] = useState<{ citaId: string; deuda: DeudaPaciente } | null>(null);
  const nombreProfesional = (d: DeudaPaciente) => profesional.get(tratante.get(d.paciente_id) ?? '') ?? 'Profesional';

  return (
    <div className="flex flex-col gap-4">
      {configuracion.data && (
        <Aviso tono="info">
          {configuracion.data.bloquearAgendaMorosos
            ? 'Mientras tengan deuda, ni el paciente ni su profesional pueden agendar una nueva hora. Administración o gestión pueden autorizarla indicando el motivo.'
            : 'El centro no bloquea la agenda por deudas: la lista es solo informativa.'}
          {configuracion.data.diasGraciaMorosidad > 0 && ` Una sesión impaga cuenta como deuda ${configuracion.data.diasGraciaMorosidad} días después.`}
        </Aviso>
      )}
      <EstadoConsulta consulta={deudas} vacio={(d) => d.length === 0} textoVacio="No hay pacientes con sesiones impagas">
        {(lista) => (
          <Tabla etiqueta="Pacientes con deuda">
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Profesional tratante</Th>
                <Th>Impaga desde</Th>
                <Th className="text-right">Sesiones</Th>
                <Th className="text-right">Saldo</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.paciente_id} className="transition-colors duration-200 hover:bg-accent-100">
                  <Td className="font-extrabold">{nombres.get(d.paciente_id) ?? 'Paciente'}</Td>
                  <Td className="font-semibold">{nombreProfesional(d)}</Td>
                  <Td className="font-semibold text-neutral-800 first-letter:uppercase">{formatoFechaLarga(d.desde)}</Td>
                  <Td className="text-right font-bold tabular-nums">{d.sesiones}</Td>
                  <Td className="text-right font-bold tabular-nums">{formatoClp(d.saldo)}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      icon="payments"
                      onClick={() => setAbierta({ citaId: d.citas[0]!, deuda: d })}
                      className="!px-3.5 !py-2 !text-[12.5px] whitespace-nowrap"
                    >
                      Registrar pago
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </EstadoConsulta>
      <RegistrarAsistenciaPago
        citaId={abierta?.citaId ?? null}
        nombrePaciente={abierta ? (nombres.get(abierta.deuda.paciente_id) ?? 'Paciente') : ''}
        nombreProfesional={abierta ? nombreProfesional(abierta.deuda) : ''}
        rol={rol}
        onCerrar={() => setAbierta(null)}
      />
    </div>
  );
}
