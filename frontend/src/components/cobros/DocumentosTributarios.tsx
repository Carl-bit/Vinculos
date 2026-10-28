'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { TIPO_DOCUMENTO_TRIBUTARIO, type DocumentoTributarioVista, type TipoDocumentoTributario } from '@/lib/cobros';
import { formatoClp, formatoFecha } from '@/lib/formato';
import type { Rol } from '@/lib/sesion';

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

/**
 * AUD-01 (E1.4): boleta o factura del SII emitida FUERA del sistema. El
 * comprobante de pago que emite el sistema no es tributario; aca se anota el
 * folio que emitio quien cobro: el centro (ADMIN/GESTION) o el profesional
 * con cobro directo. La BD decide quien puede (403 con el texto de la regla).
 */
export function DocumentosTributarios({
  citaId,
  documentos,
  emiteProfesional,
  pagadoSinDocumentar,
  rol,
}: {
  citaId: string;
  documentos: DocumentoTributarioVista[];
  /** Algun pago vigente lo cobro el profesional (cobro directo). */
  emiteProfesional: boolean;
  /** Lo pagado (neto) que aun no tiene documento vigente. */
  pagadoSinDocumentar: number;
  rol: Rol;
}) {
  const cliente = useQueryClient();
  const puede = emiteProfesional ? rol === 'PROFESIONAL' : rol === 'ADMIN' || rol === 'GESTION';
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoDocumentoTributario>(emiteProfesional ? 'BOLETA_HONORARIOS' : 'BOLETA_ELECTRONICA');
  const [folio, setFolio] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState(String(pagadoSinDocumentar));
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const listo = () => {
    void cliente.invalidateQueries({ queryKey: ['panel', 'cobros'] });
    setError(undefined);
  };
  const fallo = (texto: string) => (e: unknown) => setError(e instanceof ApiError ? e.message : texto);

  const registrar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/cobros/citas/{id}/documentos-tributarios', {
          params: { path: { id: citaId } },
          body: { tipo, folio: folio.trim(), fechaEmision: fecha, monto: Number(monto) },
        }),
      ),
    onSuccess: () => {
      listo();
      setAbierto(false);
      setFolio('');
    },
    onError: fallo('No pudimos registrar el documento.'),
  });
  const anular = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/cobros/documentos-tributarios/{id}/anulacion', { params: { path: { id } }, body: { motivo: motivo.trim() } })),
    onSuccess: () => {
      listo();
      setAnulando(null);
      setMotivo('');
    },
    onError: fallo('No pudimos anular el documento.'),
  });
  const enviar = () => {
    if (!/^\d{1,12}$/.test(folio.trim())) return setError('El folio son solo dígitos (hasta 12).');
    if (!fecha || fecha > hoy()) return setError('La fecha de emisión no puede ser futura.');
    const n = Number(monto);
    if (!Number.isInteger(n) || n < 1) return setError('Escribe un monto entero en pesos.');
    if (n > pagadoSinDocumentar) return setError(`Queda ${formatoClp(pagadoSinDocumentar)} pagado sin documento: el monto no puede ser mayor.`);
    registrar.mutate();
  };

  if (documentos.length === 0 && (!puede || pagadoSinDocumentar <= 0)) return null;
  return (
    <section aria-labelledby={`sii-${citaId}`} className="flex flex-col gap-2">
      <h3 id={`sii-${citaId}`} className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">
        Documento tributario (SII)
      </h3>
      {documentos.map((doc) => (
        <div
          key={doc.id}
          className="flex flex-wrap items-center gap-3 rounded-[14px] border border-divider bg-neutral-100 px-3.5 py-2 text-[13.5px] font-bold"
        >
          <span className={doc.estado === 'ANULADO' ? 'line-through' : undefined}>
            {TIPO_DOCUMENTO_TRIBUTARIO[doc.tipo]} folio {doc.folio}
          </span>
          <span className="flex-1 font-semibold text-neutral-800">
            {formatoFecha(doc.fechaEmision)} · {formatoClp(doc.monto)} · {doc.emisor === 'CENTRO' ? 'emitida por el centro' : 'emitida por el profesional'}
            {doc.estado === 'ANULADO' && ` · anulado${doc.motivoAnulacion ? `: ${doc.motivoAnulacion}` : ''}`}
          </span>
          {puede && doc.estado === 'REGISTRADO' && (
            <button
              type="button"
              onClick={() => setAnulando(doc.id)}
              className="cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-extrabold text-accent-700 hover:bg-accent-200"
            >
              Anular
            </button>
          )}
        </div>
      ))}
      {anulando && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-accent-500 bg-accent-100 p-3">
          <Field label="Motivo de la anulación" required hint="El registro no se borra: queda anulado con este motivo.">
            {(p) => <Input {...p} value={motivo} maxLength={500} onChange={(ev) => setMotivo(ev.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAnulando(null)}>
              Volver
            </Button>
            <Button variant="team" disabled={motivo.trim().length < 3} loading={anular.isPending} onClick={() => anular.mutate(anulando)}>
              Anular registro
            </Button>
          </div>
        </div>
      )}
      {puede && pagadoSinDocumentar > 0 && !abierto && (
        <div>
          <Button variant="ghost" icon="receipt_long" onClick={() => setAbierto(true)}>
            Registrar boleta emitida
          </Button>
        </div>
      )}
      {abierto && (
        <div className="flex flex-col gap-3 rounded-[14px] border border-divider px-3.5 py-3">
          <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
            Anota la boleta que emitiste en el SII por esta sesión. El comprobante de pago del sistema no la reemplaza.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo de documento" required>
              {(p) => (
                <Select {...p} value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoDocumentoTributario)}>
                  {(Object.keys(TIPO_DOCUMENTO_TRIBUTARIO) as TipoDocumentoTributario[])
                    .filter((t) => emiteProfesional || t !== 'BOLETA_HONORARIOS')
                    .map((t) => (
                      <option key={t} value={t}>
                        {TIPO_DOCUMENTO_TRIBUTARIO[t]}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Folio" required hint="Solo dígitos, como aparece en el documento.">
              {(p) => <Input {...p} inputMode="numeric" maxLength={12} value={folio} onChange={(ev) => setFolio(ev.target.value.replace(/\D/g, ''))} />}
            </Field>
            <Field label="Fecha de emisión" required>
              {(p) => <Input {...p} type="date" max={hoy()} value={fecha} onChange={(ev) => setFecha(ev.target.value)} />}
            </Field>
            <Field label="Monto" required hint={`Pagado sin documento: ${formatoClp(pagadoSinDocumentar)}.`}>
              {(p) => <Input {...p} inputMode="numeric" value={monto} onChange={(ev) => setMonto(ev.target.value.replace(/\D/g, ''))} />}
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button variant="team" icon="receipt_long" loading={registrar.isPending} onClick={enviar}>
              Registrar
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </section>
  );
}
