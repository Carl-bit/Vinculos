'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Estrellas } from '@/components/ui/Estrellas';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaLarga } from '@/lib/formato';
import { nombresDe, useCitasPortal, useEquipoPortal, useResenasPortal, type ResenaPortal } from '@/lib/portal';

const ESTADO: Record<ResenaPortal['estado'], { texto: string; tono: TonoBadge }> = {
  PENDIENTE: { texto: 'En revisión', tono: 'atencion' },
  PUBLICADA: { texto: 'Publicada', tono: 'positivo' },
  OCULTA: { texto: 'No publicada', tono: 'neutro' },
  RETIRADA: { texto: 'Retirada', tono: 'neutro' },
};

type Borrador = { id?: string; profesionalId: string; calificacion: number; texto: string; feedback: string; mostrarComo: 'ANONIMO' | 'NOMBRE_INICIAL' };

/**
 * Reseñas (D-1): una por profesional con al menos una sesion realizada.
 * Anonima por defecto; mostrar "Nombre + inicial" pide confirmacion. El
 * feedback privado solo lo lee el profesional. Toda reseña (nueva o
 * editada) pasa por moderacion antes de publicarse; se puede retirar.
 */
export function ResenasPortal() {
  const portal = usePortal();
  const preelegido = useSearchParams().get('profesional') ?? undefined;
  const cliente = useQueryClient();
  const resenas = useResenasPortal();
  const citas = useCitasPortal(portal.pacienteParam, true, !portal.cargando && !!portal.pacienteId);
  const equipo = useEquipoPortal();
  const nombres = nombresDe(equipo.data);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [retirar, setRetirar] = useState<ResenaPortal | null>(null);
  const [hecho, setHecho] = useState<string>();

  const mias = (resenas.data ?? []).filter((r) => !portal.pacienteId || r.pacienteId === portal.pacienteId);
  const conResena = new Set(mias.filter((r) => r.estado !== 'RETIRADA').map((r) => r.profesionalId));
  const atendidos = [
    ...new Set((citas.data ?? []).filter((c) => c.realizada && (!portal.pacienteId || c.pacienteId === portal.pacienteId)).map((c) => c.profesionalId)),
  ];
  const pendientes = atendidos.filter((id) => !conResena.has(id));

  useEffect(() => {
    if (preelegido && pendientes.includes(preelegido) && !borrador) {
      setBorrador({ profesionalId: preelegido, calificacion: 0, texto: '', feedback: '', mostrarComo: 'ANONIMO' });
    }
    // Solo al llegar con ?profesional=: no reabre el formulario despues de enviar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preelegido, pendientes.length]);

  const retiro = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/portal/resenas/{id}/retiro', { params: { path: { id } } })),
    onSuccess: () => {
      setRetirar(null);
      setHecho('Retiraste tu reseña: ya no se muestra en el perfil.');
      void cliente.invalidateQueries({ queryKey: ['portal', 'resenas'] });
    },
  });

  return (
    <div className="flex flex-col gap-[18px]">
      {hecho && (
        <Aviso tono="exito" role="status">
          {hecho}
        </Aviso>
      )}
      {borrador ? (
        <FormularioResena
          borrador={borrador}
          nombre={nombres.get(borrador.profesionalId) ?? 'tu profesional'}
          opciones={borrador.id ? [] : pendientes.map((id) => ({ id, nombre: nombres.get(id) ?? 'Profesional del centro' }))}
          onCambiar={setBorrador}
          onCancelar={() => setBorrador(null)}
          onListo={(texto) => {
            setBorrador(null);
            setHecho(texto);
          }}
        />
      ) : (
        <Panel
          titulo="Califica tu atención"
          bajada="Tu opinión ayuda a otras personas a elegir. Solo puedes calificar a profesionales con quienes tuviste al menos una sesión."
        >
          {pendientes.length === 0 ? (
            <p className="m-0 text-[13.5px] font-semibold text-neutral-700">
              {atendidos.length === 0 ? 'Podrás calificar después de tu primera sesión.' : 'Ya calificaste a todos los profesionales que te atendieron.'}
            </p>
          ) : (
            <Button
              variant="team"
              icon="star"
              onClick={() => setBorrador({ profesionalId: pendientes[0]!, calificacion: 0, texto: '', feedback: '', mostrarComo: 'ANONIMO' })}
            >
              Escribir una reseña
            </Button>
          )}
        </Panel>
      )}

      <Panel titulo="Tus reseñas" bajada="El centro revisa cada reseña antes de publicarla. Si la editas, vuelve a revisión.">
        <EstadoConsulta consulta={resenas} vacio={() => mias.length === 0} textoVacio="Todavía no escribes reseñas">
          {() => (
            <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
              {mias.map((r) => (
                <li key={r.id} className="rounded-[18px] border border-divider bg-bg px-[18px] py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 text-[14.5px] font-black tracking-[-0.015em]">
                      {nombres.get(r.profesionalId) ?? 'Profesional del centro'}
                    </span>
                    <Estrellas valor={r.calificacion} />
                    <Badge tono={ESTADO[r.estado].tono}>{ESTADO[r.estado].texto}</Badge>
                  </div>
                  {r.texto && <p className="m-0 mb-2 text-[14px] leading-relaxed font-medium text-pretty text-neutral-800">“{r.texto}”</p>}
                  <p className="m-0 text-[12.5px] font-bold text-neutral-700">
                    {r.mostrarComo === 'ANONIMO' ? 'Anónima' : 'Con tu nombre e inicial'} · {formatoFechaLarga(r.editadaEn ?? r.creadaEn)}
                  </p>
                  {r.estado === 'OCULTA' && r.motivoOcultamiento && (
                    <p className="m-0 mt-2 text-[12.5px] font-bold text-accent-800">Motivo del centro: {r.motivoOcultamiento}</p>
                  )}
                  {r.estado !== 'RETIRADA' && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        icon="edit"
                        className="!py-2"
                        onClick={() =>
                          setBorrador({
                            id: r.id,
                            profesionalId: r.profesionalId,
                            calificacion: r.calificacion,
                            texto: r.texto ?? '',
                            feedback: r.feedbackPrivado ?? '',
                            mostrarComo: r.mostrarComo,
                          })
                        }
                      >
                        Editar
                      </Button>
                      <Button variant="ghost" className="!py-2" onClick={() => setRetirar(r)}>
                        Retirar
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </Panel>

      <Modal
        abierto={!!retirar}
        onCerrar={() => setRetirar(null)}
        titulo="¿Retirar tu reseña?"
        descripcion="Deja de mostrarse en el perfil del profesional. Después no podrás escribir otra para el mismo profesional."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setRetirar(null)}>
              Volver
            </Button>
            <Button variant="team" loading={retiro.isPending} onClick={() => retirar && retiro.mutate(retirar.id)}>
              Sí, retirar
            </Button>
          </>
        }
      >
        {retiro.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {retiro.error instanceof ApiError ? retiro.error.message : 'No pudimos retirarla.'}
          </p>
        )}
      </Modal>
    </div>
  );
}

function FormularioResena({
  borrador,
  nombre,
  opciones,
  onCambiar,
  onCancelar,
  onListo,
}: {
  borrador: Borrador;
  nombre: string;
  opciones: { id: string; nombre: string }[];
  onCambiar: (b: Borrador) => void;
  onCancelar: () => void;
  onListo: (texto: string) => void;
}) {
  const portal = usePortal();
  const cliente = useQueryClient();
  const [errorEstrellas, setErrorEstrellas] = useState<string>();
  const [confirmarNombre, setConfirmarNombre] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => titulo.current?.focus(), []);
  const b = borrador;
  const cambiar = (p: Partial<Borrador>) => onCambiar({ ...b, ...p });

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        calificacion: b.calificacion,
        texto: b.texto.trim() || undefined,
        feedbackPrivado: b.feedback.trim() || undefined,
        mostrarComo: b.mostrarComo,
      };
      return b.id
        ? datos(api.PUT('/api/portal/resenas/{id}', { params: { path: { id: b.id } }, body: cuerpo }))
        : datos(api.POST('/api/portal/resenas', { body: { ...cuerpo, profesionalId: b.profesionalId, pacienteId: portal.pacienteParam } }));
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['portal', 'resenas'] });
      onListo('Gracias. Tu reseña quedó en revisión: el centro la publica en los próximos días.');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (b.calificacion < 1) {
      setErrorEstrellas('Elige de 1 a 5 estrellas.');
      return;
    }
    setErrorEstrellas(undefined);
    guardar.mutate();
  };

  return (
    <section className="rounded-lg border border-divider bg-neutral-100 px-[clamp(20px,3vw,28px)] py-[26px] shadow-sm">
      <h2 ref={titulo} tabIndex={-1} className="m-0 mb-1.5 text-[20px] font-black tracking-[-0.025em]">
        {b.id ? `Editar tu reseña de ${nombre}` : `Calificar a ${nombre}`}
      </h2>
      <p className="m-0 mb-5 text-[13.5px] font-semibold text-neutral-700">Pasa por revisión del centro antes de publicarse.</p>
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {opciones.length > 1 && (
          <Field label="Profesional">
            {(p) => (
              <Select {...p} value={b.profesionalId} onChange={(e) => cambiar({ profesionalId: e.target.value })}>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Estrellas valor={b.calificacion} onChange={(v) => cambiar({ calificacion: v })} error={errorEstrellas} />
        <Field label="Tu reseña (opcional)" hint="Se publica en el perfil del profesional. Evita datos de salud o que te identifiquen.">
          {(p) => <Textarea {...p} rows={4} maxLength={2000} value={b.texto} onChange={(e) => cambiar({ texto: e.target.value })} className="!text-[14.5px]" />}
        </Field>
        <Field label="Comentario privado para tu profesional (opcional)" hint="Solo lo lee tu profesional. No se publica.">
          {(p) => (
            <Textarea {...p} rows={3} maxLength={2000} value={b.feedback} onChange={(e) => cambiar({ feedback: e.target.value })} className="!text-[14.5px]" />
          )}
        </Field>
        <ChoiceGroup
          legend="Cómo se muestra"
          type="radio"
          options={[
            { value: 'ANONIMO', label: 'Anónima (recomendado)' },
            { value: 'NOMBRE_INICIAL', label: 'Con mi nombre e inicial del apellido' },
          ]}
          value={[b.mostrarComo]}
          onChange={([v]) => (v === 'NOMBRE_INICIAL' ? setConfirmarNombre(true) : cambiar({ mostrarComo: 'ANONIMO' }))}
        />
        {b.mostrarComo === 'NOMBRE_INICIAL' && (
          <Aviso tono="advertencia">Cualquier persona que vea el perfil sabrá que te atendiste en el centro. Puedes volver a anónima cuando quieras.</Aviso>
        )}
        {guardar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar tu reseña.'}
          </p>
        )}
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" variant="team" icon="send" loading={guardar.isPending}>
            {b.id ? 'Guardar cambios' : 'Enviar reseña'}
          </Button>
          <Button variant="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
      <Modal
        abierto={confirmarNombre}
        onCerrar={() => setConfirmarNombre(false)}
        titulo="¿Mostrar tu nombre?"
        descripcion="Tu nombre y la inicial de tu apellido aparecerán junto a la reseña. Quien la lea sabrá que eres o fuiste paciente del centro."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmarNombre(false)}>
              Mantener anónima
            </Button>
            <Button
              variant="team"
              onClick={() => {
                cambiar({ mostrarComo: 'NOMBRE_INICIAL' });
                setConfirmarNombre(false);
              }}
            >
              Sí, mostrar mi nombre
            </Button>
          </>
        }
      />
    </section>
  );
}
