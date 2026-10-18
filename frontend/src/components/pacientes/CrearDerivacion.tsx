'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import { useFicha, useTiposAtencion, type PacienteVista } from '@/lib/panel';

/**
 * "Derivar paciente" (reemplaza "reasignar", C-5): la derivacion es el unico
 * camino para cambiar de tratante. Se ofrece a los candidatos en el orden
 * elegido; al aceptar, la ficha se traspasa (el origen deja de verla). Motivo
 * y detalle son texto clinico (cifrado). Sin candidatos queda de oficio para
 * ADMIN o el supervisor.
 */
export function CrearDerivacion({ paciente, abierto, onCerrar }: { paciente: PacienteVista; abierto: boolean; onCerrar: () => void }) {
  const cuenta = useMiCuenta();
  const ficha = useFicha(paciente.id, abierto);
  const tipos = useTiposAtencion();
  const cliente = useQueryClient();
  const [tipoId, setTipoId] = useState(paciente.tipoAtencionId ?? '');
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [candidatos, setCandidatos] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const tipo = tipos.data?.find((t) => t.id === tipoId);
  const directorio = useQuery({
    queryKey: ['directorio', 'PROFESIONAL', tipo?.nombre],
    queryFn: () => datos(api.GET('/api/directorio', { params: { query: { rol: 'PROFESIONAL', tipoAtencion: tipo!.nombre } } })),
    enabled: abierto && !!tipo,
  });
  const disponibles = (directorio.data ?? []).filter((p) => p.id !== cuenta.data?.id && !candidatos.includes(p.id));
  const nombre = new Map((directorio.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));

  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/derivaciones', {
          body: { fichaId: ficha.data!.id, motivo: motivo.trim(), detalle: detalle.trim() || undefined, tipoAtencionId: tipoId, candidatos },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'derivaciones'] });
      onCerrar();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos crear la derivación.'),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!tipoId) return setError('Elige el tipo de atención que necesita.');
    if (!motivo.trim()) return setError('Escribe el motivo de la derivación.');
    if (!ficha.data) return setError('El paciente no tiene ficha abierta.');
    setError(undefined);
    crear.mutate();
  };
  const mover = (i: number, paso: -1 | 1) =>
    setCandidatos((c) => {
      const n = [...c];
      [n[i], n[i + paso]] = [n[i + paso]!, n[i]!];
      return n;
    });

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      ancho="lg"
      titulo={`Derivar a ${paciente.nombre} ${paciente.apellido}`}
      descripcion="Se ofrece a cada candidato en orden. Cuando uno acepta, pasa a ser el tratante y la ficha se traspasa: tú dejas de verla."
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Field label="Tipo de atención que necesita" required>
          {(p) => (
            <Select
              {...p}
              value={tipoId}
              onChange={(e) => {
                setTipoId(e.target.value);
                setCandidatos([]);
              }}
            >
              <option value="">Elige un tipo</option>
              {tipos.data
                ?.filter((t) => t.activo)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Motivo" required hint="Texto clínico: lo leen los candidatos para decidir. Se guarda cifrado.">
          {(p) => <Textarea {...p} rows={3} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Field>
        <Field label="Detalle (opcional)">
          {(p) => <Textarea {...p} rows={2} maxLength={5000} value={detalle} onChange={(e) => setDetalle(e.target.value)} className="!min-h-16" />}
        </Field>

        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-[12.5px] font-extrabold">Candidatos, en orden de oferta</p>
          {candidatos.length === 0 && (
            <p className="m-0 text-[13px] font-semibold text-neutral-700">Sin candidatos queda de oficio: la deriva administración o el supervisor.</p>
          )}
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {candidatos.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-[14px] border border-divider bg-neutral-100 px-3.5 py-2">
                <span className="w-5 text-[13px] font-black tabular-nums">{i + 1}.</span>
                <span className="flex-1 text-[14px] font-bold">{nombre.get(id) ?? 'Profesional'}</span>
                <button
                  type="button"
                  aria-label="Subir"
                  disabled={i === 0}
                  onClick={() => mover(i, -1)}
                  className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200 disabled:opacity-40"
                >
                  <Icon name="expand_less" />
                </button>
                <button
                  type="button"
                  aria-label="Bajar"
                  disabled={i === candidatos.length - 1}
                  onClick={() => mover(i, 1)}
                  className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200 disabled:opacity-40"
                >
                  <Icon name="expand_more" />
                </button>
                <button
                  type="button"
                  aria-label="Quitar"
                  onClick={() => setCandidatos((c) => c.filter((x) => x !== id))}
                  className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ol>
          {tipo && (
            <Field label="Agregar candidato" hint={`Profesionales con "${tipo.nombre}" aprobado.`}>
              {(p) => (
                <Select {...p} value="" onChange={(e) => e.target.value && setCandidatos((c) => [...c, e.target.value])} disabled={disponibles.length === 0}>
                  <option value="">{disponibles.length ? 'Elige un profesional' : 'No hay más profesionales con ese tipo'}</option>
                  {disponibles.map((p2) => (
                    <option key={p2.id} value={p2.id}>
                      {p2.nombre ?? 'Profesional'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {ficha.error && <Aviso tono="advertencia">El paciente no tiene ficha abierta: ábrela antes de derivar.</Aviso>}
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" variant="team" icon="call_split" loading={crear.isPending}>
            Derivar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
