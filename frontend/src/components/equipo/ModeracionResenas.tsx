'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Estrellas } from '@/components/ui/Estrellas';
import { Input } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useProfesionales } from '@/lib/consultas';
import { formatoFecha } from '@/lib/formato';

const ESTADO = {
  PENDIENTE: { texto: 'Por moderar', tono: 'atencion' },
  PUBLICADA: { texto: 'Publicada', tono: 'positivo' },
  OCULTA: { texto: 'Oculta', tono: 'neutro' },
  RETIRADA: { texto: 'Retirada', tono: 'neutro' },
} as const;

/**
 * Moderacion de reseñas (D-1, solo ADMIN): antes de publicarse en el perfil, o
 * cuando alguien las reporta. Ocultar pide motivo. No se editan ni se borran.
 * Sin datos del paciente: solo calificacion, texto y reportes.
 */
export function ModeracionResenas() {
  const cola = useQuery({ queryKey: ['equipo', 'resenas'], queryFn: () => datos(api.GET('/api/resenas')) });
  const profesionales = useProfesionales(true);
  const nombre = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));
  const cliente = useQueryClient();
  const [ocultando, setOcultando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const moderar = useMutation({
    mutationFn: ({ id, publicar }: { id: string; publicar: boolean }) =>
      datos(api.POST('/api/resenas/{id}/moderacion', { params: { path: { id } }, body: { publicar, motivo: publicar ? undefined : motivo.trim() } })),
    onSuccess: () => {
      setOcultando(null);
      setMotivo('');
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo', 'resenas'] });
      void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos moderar la reseña.'),
  });
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <EstadoConsulta consulta={cola} vacio={(l) => l.length === 0} textoVacio="No hay reseñas por moderar">
        {(l) =>
          l.map((r) => {
            const e = ESTADO[r.estado];
            return (
              <article key={r.id} className="flex flex-col gap-3 rounded-lg border border-divider bg-bg px-5 py-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <Estrellas valor={r.calificacion} />
                  <span className="text-[13.5px] font-extrabold">{nombre.get(r.profesional_id) ?? 'Profesional'}</span>
                  <span className="text-[12.5px] font-semibold text-neutral-700">{formatoFecha(r.creada_en)}</span>
                  <Badge tono={e.tono} className="ml-auto">
                    {e.texto}
                  </Badge>
                </div>
                {r.texto ? (
                  <p className="m-0 text-[14px] leading-relaxed text-neutral-800">{r.texto}</p>
                ) : (
                  <p className="m-0 text-[13px] font-semibold text-neutral-700">Sin comentario, solo calificación.</p>
                )}
                {r.reportes.length > 0 && (
                  <div className="rounded-[14px] border border-accent-500 bg-accent-100 px-3.5 py-2.5 text-[13px] font-semibold text-accent-900">
                    {r.reportes.length === 1 ? '1 reporte' : `${r.reportes.length} reportes`}: {r.reportes.map((x) => x.motivo).join(' · ')}
                  </div>
                )}
                {ocultando === r.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Motivo para ocultar"
                      placeholder="Motivo (queda registrado)"
                      value={motivo}
                      maxLength={500}
                      onChange={(ev) => setMotivo(ev.target.value)}
                      className="!min-w-[240px] flex-1 !py-2"
                    />
                    <Button variant="ghost" onClick={() => setOcultando(null)}>
                      Volver
                    </Button>
                    <Button
                      variant="team"
                      disabled={motivo.trim().length < 3}
                      loading={moderar.isPending}
                      onClick={() => moderar.mutate({ id: r.id, publicar: false })}
                    >
                      Ocultar
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2">
                    {r.estado !== 'OCULTA' && (
                      <Button variant="ghost" icon="visibility_off" onClick={() => setOcultando(r.id)} className="!py-2">
                        Ocultar
                      </Button>
                    )}
                    {r.estado !== 'PUBLICADA' && (
                      <Button
                        variant="team"
                        icon="check"
                        loading={moderar.isPending}
                        onClick={() => moderar.mutate({ id: r.id, publicar: true })}
                        className="!py-2"
                      >
                        Publicar
                      </Button>
                    )}
                  </div>
                )}
              </article>
            );
          })
        }
      </EstadoConsulta>
    </div>
  );
}
