'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta, EstadoVista } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useFichasRetencion, useRevisionesRetencion, type FichaSobreRetencion } from '@/lib/fichas';
import { formatoFecha, formatoFechaHora } from '@/lib/formato';
import { nombresPacientes, usePacientes } from '@/lib/panel';

type Decision = 'CONSERVAR' | 'PURGAR';

/**
 * Revision de retencion (solo ADMIN): fichas con mas de 15 años desde la
 * ultima atencion (Decreto 41, Ley 20.584). No hay purga automatica: la
 * decision queda registrada y la API nunca borra una ficha. La consulta misma
 * queda auditada, por eso se pide recien al pulsar "Revisar".
 */
export function RetencionFichas() {
  const [revisar, setRevisar] = useState(false);
  const fichas = useFichasRetencion(revisar);
  const revisiones = useRevisionesRetencion(true);
  const pacientes = usePacientes({}, revisar);
  const nombres = nombresPacientes(pacientes.data);
  const [decidir, setDecidir] = useState<FichaSobreRetencion | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Aviso tono="info" icono="inventory_2" titulo="Retención mínima: 15 años desde la última atención">
        La revisión es anual. Decidir &quot;purgar&quot; solo deja registrada la decisión: ninguna ficha se borra desde la aplicación.
      </Aviso>
      <Panel
        titulo="Fichas sobre el plazo"
        accion={
          !revisar && (
            <Button variant="team" icon="search" onClick={() => setRevisar(true)} className="!py-2.5">
              Revisar
            </Button>
          )
        }
      >
        {!revisar ? (
          <EstadoVista estado="vacio" titulo="Pulsa Revisar para buscar fichas" mensaje="La consulta queda registrada en la auditoría con tu usuario." />
        ) : (
          <EstadoConsulta consulta={fichas} vacio={(l) => l.length === 0} textoVacio="Ninguna ficha supera el plazo de retención">
            {(lista) => (
              <Tabla etiqueta="Fichas sobre el plazo de retención">
                <thead>
                  <tr>
                    <Th>Paciente</Th>
                    <Th>Última atención</Th>
                    <Th>Última decisión</Th>
                    <Th>
                      <span className="sr-only">Acción</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((f) => (
                    <tr key={f.ficha_id}>
                      <Td className="font-extrabold">{nombres.get(f.paciente_id) ?? 'Paciente'}</Td>
                      <Td>{formatoFecha(f.ultima_atencion_en)}</Td>
                      <Td>
                        {f.ultima_decision ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge tono={f.ultima_decision === 'PURGAR' ? 'atencion' : 'positivo'}>
                              {f.ultima_decision === 'PURGAR' ? 'Purgar' : 'Conservar'}
                            </Badge>
                            {f.ultima_revision_en && <span className="text-[12.5px] text-neutral-700">{formatoFecha(f.ultima_revision_en)}</span>}
                          </span>
                        ) : (
                          'Sin revisar'
                        )}
                      </Td>
                      <Td className="text-right">
                        <Button variant="secondary" onClick={() => setDecidir(f)} className="!px-4 !py-2 !text-[13px]">
                          Registrar decisión
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </EstadoConsulta>
        )}
      </Panel>
      <Panel titulo="Historial de revisiones">
        <EstadoConsulta consulta={revisiones} vacio={(l) => l.length === 0} textoVacio="Todavía no hay revisiones">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col p-0">
              {lista.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 border-b border-divider py-3 last:border-b-0">
                  <Badge tono={r.decision === 'PURGAR' ? 'atencion' : 'positivo'}>{r.decision === 'PURGAR' ? 'Purgar' : 'Conservar'}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[14px] font-semibold text-pretty">{r.motivo}</p>
                    <p className="m-0 text-xs font-semibold text-neutral-700">{formatoFechaHora(r.revisadoEn)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </Panel>
      <Modal abierto={!!decidir} onCerrar={() => setDecidir(null)} titulo="Registrar decisión de retención">
        {decidir && <DecisionRetencion ficha={decidir} paciente={nombres.get(decidir.paciente_id)} onListo={() => setDecidir(null)} />}
      </Modal>
    </div>
  );
}

function DecisionRetencion({ ficha, paciente, onListo }: { ficha: FichaSobreRetencion; paciente?: string; onListo: () => void }) {
  const cliente = useQueryClient();
  const [decision, setDecision] = useState<Decision>('CONSERVAR');
  const [motivo, setMotivo] = useState('');
  const guardar = useMutation({
    mutationFn: () => datos(api.POST('/api/retencion/revisiones', { body: { fichaId: ficha.ficha_id, decision, motivo: motivo.trim() } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['retencion'] });
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        {paciente ?? 'Paciente'} · última atención el {formatoFecha(ficha.ultima_atencion_en)}.
      </p>
      <ChoiceGroup
        legend="Decisión"
        type="radio"
        value={[decision]}
        onChange={(v) => setDecision((v[0] as Decision) ?? 'CONSERVAR')}
        options={[
          { value: 'CONSERVAR', label: 'Conservar (por ejemplo, por un proceso pendiente)' },
          { value: 'PURGAR', label: 'Purgar (solo se registra; la eliminación se hace fuera de la aplicación)' },
        ]}
      />
      <Field label="Motivo" required>
        {(p) => <Textarea {...p} rows={3} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Field>
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos registrar la decisión.'}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" icon="save" disabled={motivo.trim().length < 3} loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Registrar
        </Button>
      </div>
    </div>
  );
}
