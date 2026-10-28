'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFecha, formatoFechaHora } from '@/lib/formato';

type Contrato = components['schemas']['ContratoCentroVista'];
type Tipo = Contrato['pendientes'][number];

const TITULO: Record<Tipo, string> = {
  TERMINOS_SERVICIO: 'Términos de servicio de Vinculos',
  DPA: 'Anexo de tratamiento de datos (DPA)',
};

const useContrato = (habilitado = true) =>
  useQuery({ queryKey: ['contrato-centro'], queryFn: () => datos(api.GET('/api/contrato-centro')), enabled: habilitado });

function useAceptar() {
  const cliente = useQueryClient();
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: (tipo: Tipo) => datos(api.POST('/api/contrato-centro/aceptacion', { body: { tipo } })),
    onSuccess: (c) => {
      setError(undefined);
      cliente.setQueryData(['contrato-centro'], c);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos registrar la aceptación.'),
  });
  return { ...m, error };
}

function Documento({ texto }: { texto: string }) {
  return (
    <div className="max-h-[320px] overflow-y-auto rounded-[14px] border border-divider bg-neutral-100 px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line">
      {texto}
    </div>
  );
}

/**
 * AUD-01 (E2.2): si hay una version vigente de los terminos de servicio o del
 * DPA sin aceptar, la cuenta madre (ADMIN) la lee y la acepta antes de seguir.
 * Queda la version, la fecha y quien acepto. Los demas roles no lo ven.
 */
export function ContratoPendiente({ esAdmin }: { esAdmin: boolean }) {
  const contrato = useContrato(esAdmin);
  const aceptar = useAceptar();
  const pendiente = contrato.data?.vigentes.find((v) => contrato.data?.pendientes.includes(v.tipo));
  if (!esAdmin || !pendiente) return null;
  return (
    <Modal
      abierto
      cerrable={false}
      onCerrar={() => undefined}
      ancho="lg"
      titulo={`Nueva versión: ${TITULO[pendiente.tipo]}`}
      descripcion={`Versión ${pendiente.version}, vigente desde el ${formatoFecha(pendiente.vigenteDesde)}. Para seguir usando el panel, léela y acéptala a nombre del centro.`}
      acciones={
        <Button variant="team" loading={aceptar.isPending} onClick={() => aceptar.mutate(pendiente.tipo)}>
          Acepto a nombre del centro
        </Button>
      }
    >
      <Documento texto={pendiente.texto} />
      {aceptar.error && (
        <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
          {aceptar.error}
        </p>
      )}
    </Modal>
  );
}

/** Configuracion > Consentimiento y politicas: el contrato vigente con Vinculos y quien lo acepto. */
export function ContratoCentroPanel() {
  const contrato = useContrato();
  const aceptar = useAceptar();
  const [abierto, setAbierto] = useState<Tipo | null>(null);
  return (
    <Panel
      titulo="Contrato con Vinculos"
      bajada="Términos de servicio y anexo de tratamiento de datos entre el centro y Vinculos. Los publica Vinculos; el centro los acepta y queda registrado quién y cuándo."
    >
      <div className="mt-4">
        <EstadoConsulta consulta={contrato} vacio={(c) => c.vigentes.length === 0} textoVacio="Vinculos aún no publica el contrato del centro">
          {(c) => (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {c.vigentes.map((v) => {
                const pendiente = c.pendientes.includes(v.tipo);
                return (
                  <li key={v.tipo} className="flex flex-col gap-2 rounded-lg border border-divider px-[18px] py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold">{TITULO[v.tipo]}</span>
                      <Badge tono="neutro">Versión {v.version}</Badge>
                      <Badge tono={pendiente ? 'atencion' : 'positivo'}>{pendiente ? 'Pendiente de aceptar' : 'Aceptada'}</Badge>
                    </div>
                    <p className="m-0 text-[13px] font-semibold text-neutral-800">
                      Vigente desde el {formatoFecha(v.vigenteDesde)}.
                      {v.aceptaciones.map((a) => ` Aceptó ${a.por ?? 'ex integrante del equipo'} el ${formatoFechaHora(a.aceptadaEn)}.`).join('')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => setAbierto(abierto === v.tipo ? null : v.tipo)}>
                        {abierto === v.tipo ? 'Ocultar texto' : 'Leer'}
                      </Button>
                      {pendiente && (
                        <Button variant="team" loading={aceptar.isPending} onClick={() => aceptar.mutate(v.tipo)}>
                          Acepto a nombre del centro
                        </Button>
                      )}
                    </div>
                    {abierto === v.tipo && <Documento texto={v.texto} />}
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
        {aceptar.error && (
          <Aviso tono="advertencia" role="alert">
            {aceptar.error}
          </Aviso>
        )}
      </div>
    </Panel>
  );
}
