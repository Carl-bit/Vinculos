'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora } from '@/lib/formato';

type Alcance = components['schemas']['AlcanceSoporte'];
const ALCANCES: { valor: Alcance; texto: string; ayuda: string }[] = [
  { valor: 'DIAGNOSTICO', texto: 'Diagnóstico', ayuda: 'Conteos y estado de envíos, sin personas.' },
  { valor: 'CONFIGURACION', texto: 'Diagnóstico y configuración', ayuda: 'Además, los parámetros del centro (sin su RUT).' },
];
const FUNCIONES: Record<string, string> = {
  soporte_resumen: 'Resumen del estado del sistema',
  soporte_notificaciones_con_error: 'Envíos con error',
  soporte_configuracion: 'Parámetros del centro',
};

/**
 * AUD-01 (E2.1): el centro autoriza al soporte de Vinculos por un plazo y
 * alcance, lo revoca cuando quiere y ve cada diagnostico ejecutado. El
 * soporte nunca ve datos personales ni clinicos (docs/cumplimiento/soporte.md).
 */
export function SoporteCentro() {
  const cliente = useQueryClient();
  const autorizaciones = useQuery({ queryKey: ['soporte', 'autorizaciones'], queryFn: () => datos(api.GET('/api/soporte/autorizaciones')) });
  const registro = useQuery({ queryKey: ['soporte', 'registro'], queryFn: () => datos(api.GET('/api/soporte/registro')) });
  const [motivo, setMotivo] = useState('');
  const [alcance, setAlcance] = useState<Alcance>('DIAGNOSTICO');
  const [horas, setHoras] = useState('24');
  const [error, setError] = useState<string>();
  const refrescar = () => {
    setError(undefined);
    void cliente.invalidateQueries({ queryKey: ['soporte'] });
  };
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);
  const otorgar = useMutation({
    mutationFn: () => datos(api.POST('/api/soporte/autorizaciones', { body: { motivo: motivo.trim(), alcance, horas: Number(horas) } })),
    onSuccess: () => {
      setMotivo('');
      refrescar();
    },
    onError: fallo('No pudimos registrar la autorización.'),
  });
  const revocar = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/soporte/autorizaciones/{id}/revocacion', { params: { path: { id } } })),
    onSuccess: refrescar,
    onError: fallo('No pudimos revocar la autorización.'),
  });
  const enviar = () => {
    const h = Number(horas);
    if (motivo.trim().length < 5) return setError('Describe el motivo (al menos 5 caracteres).');
    if (!Number.isInteger(h) || h < 1 || h > 72) return setError('El plazo va de 1 a 72 horas.');
    otorgar.mutate();
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel titulo="Soporte de Vinculos" bajada="Autoriza al equipo de Vinculos a revisar el estado del sistema por un plazo acotado.">
        <Aviso tono="nota" titulo="El soporte nunca ve datos de pacientes ni del equipo">
          Solo ejecuta diagnósticos con conteos y estados (por ejemplo, cuántos correos fallaron). No ve nombres, contactos, RUT ni fichas.
          Cada diagnóstico queda registrado abajo.
        </Aviso>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <Field label="Motivo" required hint="Lo que pediste al soporte. Queda registrado.">
            {(p) => <Textarea {...p} rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Field>
          <Field label="Alcance" hint={ALCANCES.find((a) => a.valor === alcance)?.ayuda}>
            {(p) => (
              <Select {...p} value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)}>
                {ALCANCES.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.texto}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Plazo (horas)" hint="De 1 a 72.">
            {(p) => <Input {...p} inputMode="numeric" className="!w-[110px]" value={horas} onChange={(e) => setHoras(e.target.value.replace(/\D/g, ''))} />}
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="team" icon="admin_panel_settings" loading={otorgar.isPending} onClick={enviar}>
            Autorizar soporte
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 mt-2 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </Panel>

      <Panel titulo="Autorizaciones" bajada="Las últimas 50, de la más reciente a la más antigua.">
        <div className="mt-4">
          <EstadoConsulta consulta={autorizaciones} vacio={(a) => a.length === 0} textoVacio="Aún no has autorizado al soporte">
            {(lista) => (
              <Tabla etiqueta="Autorizaciones de soporte">
                <thead>
                  <tr>
                    <Th>Estado</Th>
                    <Th>Motivo</Th>
                    <Th>Alcance</Th>
                    <Th>Vigencia</Th>
                    <Th>Usos</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((a) => (
                    <tr key={a.id}>
                      <Td>
                        <Badge tono={a.vigente ? 'atencion' : 'neutro'}>{a.vigente ? 'Vigente' : a.revocadaEn ? 'Revocada' : 'Vencida'}</Badge>
                      </Td>
                      <Td>
                        {a.motivo}
                        <span className="block text-[12.5px] font-semibold text-neutral-700">Autorizó {a.otorgadaPor ?? 'ex integrante del equipo'}</span>
                      </Td>
                      <Td>{ALCANCES.find((x) => x.valor === a.alcance)?.texto}</Td>
                      <Td className="whitespace-nowrap tabular-nums">
                        {formatoFechaHora(a.desde)}
                        <span className="block">hasta {formatoFechaHora(a.revocadaEn ?? a.hasta)}</span>
                      </Td>
                      <Td className="tabular-nums">{a.usos}</Td>
                      <Td>
                        {a.vigente && (
                          <Button variant="ghost" loading={revocar.isPending && revocar.variables === a.id} onClick={() => revocar.mutate(a.id)}>
                            Revocar
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </EstadoConsulta>
        </div>
      </Panel>

      <Panel titulo="Registro del soporte" bajada="Cada diagnóstico que ejecutó el soporte, con la autorización que lo cubrió.">
        <div className="mt-4">
          <EstadoConsulta consulta={registro} vacio={(r) => r.length === 0} textoVacio="El soporte no ha ejecutado diagnósticos">
            {(filas) => (
              <Tabla etiqueta="Registro del soporte">
                <thead>
                  <tr>
                    <Th>Fecha y hora</Th>
                    <Th>Diagnóstico</Th>
                    <Th>Conexión</Th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatoFechaHora(f.ocurridoEn)}</Td>
                      <Td>{FUNCIONES[f.funcion] ?? f.funcion}</Td>
                      <Td className="text-[13px] text-neutral-800">{f.rolBd}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}
