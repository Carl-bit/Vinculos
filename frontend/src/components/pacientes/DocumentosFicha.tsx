'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { descargarArchivo, pedirArchivo } from '@/lib/descargas';
import { useDocumentosPaciente, useEnviosDocumento, useTiposDocumento, type DocumentoClinico } from '@/lib/fichas';
import { formatoFechaHora, formatoFechaLarga } from '@/lib/formato';

const MAX_CONTENIDO = 20_000;

/**
 * Documentos clinicos emitidos por el tratante (certificados, informes,
 * epicrisis): se redactan aca, se revisan en la vista previa del PDF (el mismo
 * que recibira el paciente) y se envian por correo con un enlace que expira o,
 * si el paciente lo pidio, adjuntos. Emitido, no se edita.
 */
export function DocumentosFicha({ pacienteId }: { pacienteId: string }) {
  const documentos = useDocumentosPaciente(pacienteId);
  const tipos = useTiposDocumento();
  const [emitir, setEmitir] = useState(false);
  const nombreTipo = new Map((tipos.data ?? []).map((t) => [t.id, t.nombre]));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[560px] text-[13.5px] font-semibold text-neutral-800">
          Lo único clínico que sale por correo son documentos emitidos aquí. Por defecto va un enlace que expira y exige iniciar sesión.
        </p>
        <Button variant="team" icon="description" onClick={() => setEmitir(true)}>
          Emitir documento
        </Button>
      </div>
      <EstadoConsulta consulta={documentos} vacio={(l) => l.length === 0} textoVacio="Sin documentos emitidos">
        {(lista) => (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {lista.map((d) => (
              <FilaDocumento key={d.id} documento={d} tipo={nombreTipo.get(d.tipoDocumentoId) ?? 'Documento'} />
            ))}
          </ul>
        )}
      </EstadoConsulta>
      <Modal abierto={emitir} onCerrar={() => setEmitir(false)} titulo="Emitir documento" ancho="lg">
        {emitir && <EmitirDocumento pacienteId={pacienteId} onListo={() => setEmitir(false)} />}
      </Modal>
    </div>
  );
}

function FilaDocumento({ documento: d, tipo }: { documento: DocumentoClinico; tipo: string }) {
  const [verEnvios, setVerEnvios] = useState(false);
  const [enviar, setEnviar] = useState(false);
  const [descarga, setDescarga] = useState<string>();
  const ver = async () => {
    setDescarga(undefined);
    const r = await descargarArchivo(`/api/documentos-clinicos/${d.id}/copia`, d.nombreArchivo);
    if (r !== 'listo') setDescarga('No pudimos abrir el PDF. Intenta de nuevo.');
  };
  return (
    <li className="rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon name="picture_as_pdf" size={22} className="flex-none text-accent-700" />
          <div className="min-w-0">
            <p className="m-0 text-[14.5px] font-extrabold">{tipo}</p>
            <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Emitido el {formatoFechaHora(d.emitidoEn)}</p>
          </div>
          {d.adjuntoSolicitadoEn && <Badge tono="atencion">Pidió el adjunto</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon="download" onClick={() => void ver()} className="!px-3.5 !py-2 !text-[13px]">
            Ver PDF
          </Button>
          <Button variant="ghost" icon="history" aria-expanded={verEnvios} onClick={() => setVerEnvios((v) => !v)} className="!px-3.5 !py-2 !text-[13px]">
            Envíos
          </Button>
          <Button variant="secondary" icon="send" onClick={() => setEnviar(true)} className="!px-4 !py-2 !text-[13px]">
            Enviar por correo
          </Button>
        </div>
      </div>
      {descarga && (
        <p role="alert" className="m-0 mt-2 text-[13px] font-bold text-accent-700">
          {descarga}
        </p>
      )}
      {verEnvios && <EnviosDocumento documentoId={d.id} />}
      <Modal abierto={enviar} onCerrar={() => setEnviar(false)} titulo="Enviar por correo">
        {enviar && <EnviarDocumento documento={d} onListo={() => setEnviar(false)} />}
      </Modal>
    </li>
  );
}

function EnviosDocumento({ documentoId }: { documentoId: string }) {
  const envios = useEnviosDocumento(documentoId, true);
  return (
    <div className="mt-3 border-t border-divider pt-3">
      <EstadoConsulta consulta={envios} vacio={(l) => l.length === 0} textoVacio="Todavía no se envía">
        {(lista) => (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {lista.map((e) => (
              <li key={e.id} className="text-[13px] font-semibold text-neutral-800">
                <span className="font-extrabold">{e.modo === 'ENLACE' ? 'Enlace' : 'Adjunto'}</span> · enviado el {formatoFechaHora(e.enviadoEn)}
                {e.expiraEn && ` · vence el ${formatoFechaHora(e.expiraEn)}`}
                {' · '}
                {e.descargas.length === 0
                  ? 'sin descargas'
                  : `${e.descargas.length === 1 ? '1 descarga' : `${e.descargas.length} descargas`} (última: ${formatoFechaHora(e.descargas.at(-1)!.descargadoEn)})`}
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
    </div>
  );
}

function EnviarDocumento({ documento, onListo }: { documento: DocumentoClinico; onListo: () => void }) {
  const cliente = useQueryClient();
  const [modo, setModo] = useState<'ENLACE' | 'ADJUNTO'>('ENLACE');
  const [listo, setListo] = useState<string>();
  const enviar = useMutation({
    mutationFn: () => datos(api.POST('/api/documentos-clinicos/{id}/envios', { params: { path: { id: documento.id } }, body: { modo } })),
    onSuccess: (e) => {
      void cliente.invalidateQueries({ queryKey: ['ficha', 'envios', documento.id] });
      setListo(e.expiraEn ? `Enviado. El enlace vence el ${formatoFechaHora(e.expiraEn)}.` : 'Enviado con el PDF adjunto.');
    },
  });
  if (listo)
    return (
      <div className="flex flex-col gap-4">
        <Aviso tono="exito" role="status">
          {listo}
        </Aviso>
        <div className="flex justify-end">
          <Button variant="team" onClick={onListo}>
            Listo
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <ChoiceGroup
        legend="Cómo lo recibe"
        type="radio"
        value={[modo]}
        onChange={(v) => setModo((v[0] as 'ENLACE' | 'ADJUNTO') ?? 'ENLACE')}
        options={[
          { value: 'ENLACE', label: 'Enlace que expira (exige iniciar sesión; cada descarga queda registrada)' },
          ...(documento.adjuntoSolicitadoEn
            ? [{ value: 'ADJUNTO', label: `PDF adjunto (lo pidió el ${formatoFechaLarga(documento.adjuntoSolicitadoEn)})` }]
            : []),
        ]}
      />
      {!documento.adjuntoSolicitadoEn && (
        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">El adjunto solo se envía si el paciente lo pide desde su cuenta.</p>
      )}
      {enviar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {enviar.error instanceof ApiError ? enviar.error.message : 'No pudimos enviar el documento.'}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" icon="send" loading={enviar.isPending} onClick={() => enviar.mutate()}>
          Enviar
        </Button>
      </div>
    </div>
  );
}

function EmitirDocumento({ pacienteId, onListo }: { pacienteId: string; onListo: () => void }) {
  const cliente = useQueryClient();
  const tipos = useTiposDocumento();
  const [tipoDocumentoId, setTipo] = useState('');
  const [contenido, setContenido] = useState('');
  const [previa, setPrevia] = useState<string>();
  const [confirmar, setConfirmar] = useState(false);
  const cuerpo = { pacienteId, tipoDocumentoId, contenido: contenido.trim() };

  // El PDF de la vista previa vive solo en memoria (object URL) y se libera al cambiar o cerrar.
  useEffect(() => () => void (previa && URL.revokeObjectURL(previa)), [previa]);

  const verPrevia = useMutation({
    mutationFn: () => pedirArchivo('/api/documentos-clinicos/vista-previa', cuerpo),
    onSuccess: (blob) => setPrevia(URL.createObjectURL(blob)),
  });
  const emitir = useMutation({
    mutationFn: () => datos(api.POST('/api/documentos-clinicos', { body: cuerpo })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['ficha', 'documentos', pacienteId] });
      onListo();
    },
  });
  const cambiar = (f: () => void) => {
    f();
    setPrevia(undefined);
  };
  const completo = !!tipoDocumentoId && !!contenido.trim();
  const error = verPrevia.error ?? emitir.error;

  if (confirmar)
    return (
      <div className="flex flex-col gap-4">
        <Aviso tono="advertencia" icono="description" titulo="¿Emitir este documento?">
          Queda en la ficha tal como lo viste en la vista previa y ya no se edita. Después puedes enviarlo por correo.
        </Aviso>
        {emitir.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {emitir.error instanceof ApiError ? emitir.error.message : 'No pudimos emitir el documento.'}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setConfirmar(false)}>
            Volver
          </Button>
          <Button variant="team" icon="task_alt" loading={emitir.isPending} onClick={() => emitir.mutate()}>
            Emitir
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Field label="Tipo de documento" required hint="Los tipos y su formato los define administración.">
        {(p) => (
          <Select {...p} value={tipoDocumentoId} onChange={(e) => cambiar(() => setTipo(e.target.value))}>
            <option value="">Elige el tipo</option>
            {(tipos.data ?? [])
              .filter((t) => t.activo)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Contenido" required hint="El nombre del paciente, el tuyo, la fecha y el centro los agrega el formato del documento.">
        {(p) => (
          <Textarea
            {...p}
            rows={9}
            maxLength={MAX_CONTENIDO}
            value={contenido}
            onChange={(e) => cambiar(() => setContenido(e.target.value))}
            className="!min-h-48"
          />
        )}
      </Field>
      {previa && (
        <div className="overflow-hidden rounded-lg border border-divider bg-neutral-100">
          <p className="m-0 border-b border-divider px-4 py-2.5 text-[12.5px] font-extrabold text-neutral-700">Vista previa del PDF</p>
          <iframe src={previa} title="Vista previa del documento" className="block h-[min(70vh,620px)] w-full bg-bg" />
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error instanceof ApiError ? error.message : 'No pudimos generar la vista previa.'}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="secondary" icon="visibility" disabled={!completo} loading={verPrevia.isPending} onClick={() => verPrevia.mutate()}>
          {previa ? 'Actualizar vista previa' : 'Vista previa'}
        </Button>
        <Button variant="team" icon="task_alt" disabled={!completo || !previa} onClick={() => setConfirmar(true)}>
          Emitir
        </Button>
      </div>
      {!previa && completo && <p className="m-0 text-right text-[12.5px] font-semibold text-neutral-700">Revisa la vista previa antes de emitir.</p>}
    </div>
  );
}
