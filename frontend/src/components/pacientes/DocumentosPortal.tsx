'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { descargarArchivo } from '@/lib/descargas';
import { formatoFechaLarga } from '@/lib/formato';
import { nombresDe, useDocumentosPortal, useEpicrisisPortal, useEquipoPortal, type SolicitudEpicrisis } from '@/lib/portal';

const titulo = (archivo: string) => archivo.replace(/\.pdf$/i, '');

/**
 * Documentos emitidos por el tratante (certificados, informes): se ven aqui
 * y el PDF llega por correo con un enlace que exige iniciar sesion. Si el
 * paciente lo prefiere adjunto, lo pide (queda registrado y el profesional
 * puede enviarlo asi).
 */
export function DocumentosPortal() {
  const portal = usePortal();
  const docs = useDocumentosPortal(portal.pacienteParam, !portal.cargando);
  const equipo = useEquipoPortal();
  const nombres = nombresDe(equipo.data);
  const cliente = useQueryClient();
  const [errorId, setErrorId] = useState<{ id: string; mensaje: string }>();
  const [bajando, setBajando] = useState<string>();
  const descargar = async (id: string, archivo: string) => {
    setErrorId(undefined);
    setBajando(id);
    const r = await descargarArchivo(`/api/documentos-clinicos/${id}/pdf`, archivo);
    setBajando(undefined);
    if (r !== 'listo') setErrorId({ id, mensaje: 'No pudimos descargar el documento. Intenta de nuevo en unos minutos.' });
  };
  const pedirAdjunto = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/documentos-clinicos/{id}/solicitud-adjunto', { params: { path: { id } } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['portal', 'documentos'] }),
    onError: (e, id) => setErrorId({ id, mensaje: e instanceof ApiError ? e.message : 'No pudimos registrar tu solicitud.' }),
  });
  const lista = (docs.data ?? []).filter((d) => !portal.pacienteId || d.pacienteId === portal.pacienteId);

  return (
    <Panel
      titulo="Documentos emitidos"
      bajada="Certificados e informes que tu profesional emitió. Descárgalos aquí; cada descarga queda registrada en tu ficha."
    >
      <EstadoConsulta consulta={docs} vacio={() => lista.length === 0} textoVacio="Todavía no tienes documentos emitidos">
        {() => (
          <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
            {lista.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3.5 rounded-[18px] border border-divider bg-bg px-[18px] py-4">
                <span className="grid size-10 flex-none place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
                  <Icon name="picture_as_pdf" size={20} />
                </span>
                <div className="min-w-0 flex-[1_1_200px]">
                  <p className="m-0 text-[14.5px] font-black tracking-[-0.015em]">{titulo(d.nombreArchivo)}</p>
                  <p className="m-0 text-[13px] font-semibold text-neutral-700">
                    Emitido el {formatoFechaLarga(d.emitidoEn)} por {nombres.get(d.emitidoPorId) ?? 'tu profesional'}
                  </p>
                </div>
                <Button icon="download" loading={bajando === d.id} onClick={() => void descargar(d.id, d.nombreArchivo)} className="!py-2.5">
                  Descargar
                </Button>
                {d.adjuntoSolicitadoEn ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-accent-2-800">
                    <Icon name="task_alt" size={16} />
                    Lo pediste adjunto
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    icon="attach_file"
                    loading={pedirAdjunto.isPending && pedirAdjunto.variables === d.id}
                    onClick={() => {
                      setErrorId(undefined);
                      pedirAdjunto.mutate(d.id);
                    }}
                    className="!py-2.5"
                  >
                    Recibirlo adjunto por correo
                  </Button>
                )}
                {errorId?.id === d.id && (
                  <p role="alert" className="m-0 w-full text-[12.5px] font-bold text-accent-700">
                    {errorId.mensaje}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

const ESTADO_EPICRISIS: Record<SolicitudEpicrisis['estado'], { texto: string; tono: TonoBadge }> = {
  SOLICITADA: { texto: 'Solicitada', tono: 'atencion' },
  EN_PROCESO: { texto: 'En preparación', tono: 'atencion' },
  ENTREGADA: { texto: 'Entregada', tono: 'positivo' },
  RECHAZADA: { texto: 'Rechazada', tono: 'neutro' },
};

/**
 * Copia de la ficha (epicrisis, derecho de acceso de la Ley 20.584): el
 * paciente adulto o el adulto responsable la pide; el centro la prepara y la
 * entrega. El portal nunca muestra la ficha.
 */
export function CopiaFicha() {
  const portal = usePortal();
  const solicitudes = useEpicrisisPortal(!portal.cargando);
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [enviada, setEnviada] = useState(false);
  const pedir = useMutation({
    mutationFn: () => datos(api.POST('/api/portal/epicrisis', { body: { motivo: motivo.trim() || undefined, pacienteId: portal.pacienteParam } })),
    onSuccess: () => {
      setMotivo('');
      setEnviada(true);
      void cliente.invalidateQueries({ queryKey: ['portal', 'epicrisis'] });
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setEnviada(false);
    pedir.mutate();
  };
  const lista = (solicitudes.data ?? []).filter((s) => !portal.pacienteId || s.pacienteId === portal.pacienteId);

  return (
    <Panel
      id="copia"
      titulo="Copia de la ficha clínica"
      bajada="Tienes derecho a una copia de tu ficha (epicrisis). El centro la prepara y te avisa cuando esté lista; no se muestra en esta cuenta."
    >
      {enviada && (
        <Aviso tono="exito" role="status" className="mb-4">
          Recibimos tu solicitud. El centro te avisará cuando la copia esté lista.
        </Aviso>
      )}
      <form onSubmit={enviar} className="mb-6 flex flex-col gap-3.5" noValidate>
        <Field label="Para qué la necesitas (opcional)" hint="Ayuda al centro a preparar lo que necesitas. No incluyas detalles clínicos.">
          {(p) => <Textarea {...p} rows={3} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} className="!text-[14.5px]" />}
        </Field>
        {pedir.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {pedir.error instanceof ApiError ? pedir.error.message : 'No pudimos enviar la solicitud.'}
          </p>
        )}
        <div>
          <Button type="submit" icon="send" loading={pedir.isPending}>
            Pedir copia
          </Button>
        </div>
      </form>
      <h3 className="m-0 mb-3 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Tus solicitudes</h3>
      <EstadoConsulta consulta={solicitudes} vacio={() => lista.length === 0} textoVacio="No has pedido copias">
        {() => (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {lista.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-divider bg-bg px-[18px] py-3.5">
                <span className="min-w-0 flex-1 text-[13.5px] font-bold first-letter:uppercase">
                  Pedida el {formatoFechaLarga(s.solicitadaEn)}
                  {s.resueltaEn ? ` · resuelta el ${formatoFechaLarga(s.resueltaEn)}` : ''}
                </span>
                <Badge tono={ESTADO_EPICRISIS[s.estado].tono}>{ESTADO_EPICRISIS[s.estado].texto}</Badge>
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
    </Panel>
  );
}
