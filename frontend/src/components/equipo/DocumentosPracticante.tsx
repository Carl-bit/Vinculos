'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { descargarArchivo } from '@/lib/descargas';
import { formatoFecha } from '@/lib/formato';
import { subirArchivo } from '@/lib/subidas';

import { VisorArchivo } from './VisorArchivo';

type Documento = components['schemas']['DocumentoPracticanteVista'];
type Tipo = Documento['tipo'];

const TIPOS: { tipo: Tipo; nombre: string; ayuda: string }[] = [
  { tipo: 'CERTIFICADO_ALUMNO_REGULAR', nombre: 'Certificado de alumno regular', ayuda: 'Indica hasta cuándo vale.' },
  { tipo: 'CONVENIO_PRACTICA', nombre: 'Convenio de práctica', ayuda: 'Carta o convenio de la universidad.' },
];
const ACEPTA = 'application/pdf,image/png,image/jpeg';

export function useDocumentosPracticante(practicanteId: string | undefined) {
  return useQuery({
    queryKey: ['equipo', 'documentos-practicante', practicanteId],
    queryFn: () => datos(api.GET('/api/practicantes/{id}/documentos', { params: { path: { id: practicanteId! } } })),
    enabled: !!practicanteId,
  });
}

/**
 * Documentos de la practica (2026-11-08): certificado de alumno regular y
 * convenio, versionados y cifrados. Son parte del perfil del practicante: no
 * habilitan ni cortan el acceso (eso lo definen las fechas de la practica).
 * Suben el propio practicante o la cuenta madre (`puedeSubir`).
 */
export function DocumentosPracticante({ practicanteId, puedeSubir }: { practicanteId: string; puedeSubir: boolean }) {
  const documentos = useDocumentosPracticante(practicanteId);
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {TIPOS.map((t) => (
        <FilaDocumento
          key={t.tipo}
          practicanteId={practicanteId}
          info={t}
          versiones={(documentos.data ?? []).filter((d) => d.tipo === t.tipo)}
          cargando={documentos.isPending}
          puedeSubir={puedeSubir}
        />
      ))}
    </ul>
  );
}

function FilaDocumento({
  practicanteId,
  info,
  versiones,
  cargando,
  puedeSubir,
}: {
  practicanteId: string;
  info: (typeof TIPOS)[number];
  versiones: Documento[];
  cargando: boolean;
  puedeSubir: boolean;
}) {
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [viendo, setViendo] = useState(false);
  const [vigente, setVigente] = useState('');
  const [error, setError] = useState<string>();
  const [ultimo, ...anteriores] = versiones;
  const certificado = info.tipo === 'CERTIFICADO_ALUMNO_REGULAR';
  const subir = useMutation({
    mutationFn: (a: File) => {
      const q = new URLSearchParams({ tipo: info.tipo, ...(certificado && vigente ? { vigenteHasta: vigente } : {}) });
      return subirArchivo<Documento>(`/api/practicantes/${practicanteId}/documentos?${q}`, 'archivo', a);
    },
    onSuccess: () => {
      setError(undefined);
      setVigente('');
      void cliente.invalidateQueries({ queryKey: ['equipo', 'documentos-practicante', practicanteId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos subir el documento.'),
  });
  const elegir = (e: ChangeEvent<HTMLInputElement>) => {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (a) subir.mutate(a);
  };
  const ruta = ultimo ? `/api/practicantes/documentos/${ultimo.id}` : '';
  return (
    <li className="flex flex-col gap-2 rounded-[14px] bg-neutral-100 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Icon name={ultimo ? 'description' : 'warning'} size={20} className={ultimo ? 'text-accent-800' : 'text-accent-700'} />
        <span className="min-w-0 flex-[1_1_200px]">
          <span className="block text-[13.5px] font-extrabold">{info.nombre}</span>
          <span className="block text-[12px] font-semibold text-neutral-700">
            {cargando
              ? 'Cargando…'
              : ultimo
                ? `${ultimo.nombreArchivo} · subido el ${formatoFecha(ultimo.subidoEn)}${
                    ultimo.vigenteHasta ? ` · vale hasta el ${formatoFecha(String(ultimo.vigenteHasta).slice(0, 10))}` : ''
                  }${anteriores.length ? ` · ${anteriores.length} ${anteriores.length === 1 ? 'versión anterior' : 'versiones anteriores'}` : ''}`
                : `Todavía no se sube. ${info.ayuda}`}
          </span>
        </span>
        {ultimo && (
          <>
            <button
              type="button"
              onClick={() => setViendo(true)}
              aria-label={`Ver ${info.nombre}`}
              className="grid size-9 cursor-pointer place-items-center rounded-full text-accent-800 hover:bg-accent-200"
            >
              <Icon name="visibility" size={18} />
            </button>
            <button
              type="button"
              onClick={() => void descargarArchivo(ruta, ultimo.nombreArchivo)}
              aria-label={`Descargar ${info.nombre}`}
              className="grid size-9 cursor-pointer place-items-center rounded-full text-accent-800 hover:bg-accent-200"
            >
              <Icon name="download" size={18} />
            </button>
          </>
        )}
      </div>
      {puedeSubir && (
        <div className="flex flex-wrap items-end gap-2">
          {certificado && (
            <div className="w-[180px]">
              <Field label="Vale hasta (opcional)">
                {(x) => <Input {...x} type="date" value={vigente} onChange={(e) => setVigente(e.target.value)} className="!py-2" />}
              </Field>
            </div>
          )}
          <input ref={entrada} type="file" accept={ACEPTA} onChange={elegir} className="sr-only" tabIndex={-1} aria-hidden="true" />
          <Button
            variant="secondary"
            icon="upload"
            loading={subir.isPending}
            onClick={() => entrada.current?.click()}
            className="!min-h-9 !px-3 !py-1.5 !text-[12.5px]"
          >
            {ultimo ? 'Nueva versión' : 'Subir'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {error}
        </p>
      )}
      {ultimo && <VisorArchivo abierto={viendo} onCerrar={() => setViendo(false)} ruta={ruta} nombre={ultimo.nombreArchivo} tipoMime={ultimo.tipoMime} />}
    </li>
  );
}
