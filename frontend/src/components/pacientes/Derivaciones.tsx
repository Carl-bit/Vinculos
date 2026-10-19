'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { Pestanas } from '@/components/ui/Pestanas';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import {
  ESTADO_CANDIDATO,
  ESTADO_DERIVACION,
  useDerivacionesLista,
  useOfertasDerivacion,
  usePendientesDerivacion,
  type Derivacion,
  type DerivacionPendiente,
  type EstadoDerivacion,
  type OfertaDerivacion,
} from '@/lib/derivaciones';
import { useSupervisiones } from '@/lib/equipo';
import { formatoFecha, formatoFechaHora } from '@/lib/formato';
import { nombresPacientes, useEquipoAgenda, usePacientes, useTiposAtencion } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

const ABIERTAS: readonly EstadoDerivacion[] = ['PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'SIN_ASIGNAR'];
const textoError = (e: unknown, base: string) => (e instanceof ApiError ? e.message : base);

/**
 * Fichas › Derivaciones (C-4): unico camino para cambiar de tratante.
 * - Ofertas para el candidato: solo motivo, edad y tipo de atencion (nunca
 *   quien la origino ni quien rechazo antes); aceptar traspasa la ficha.
 * - Bandeja de ADMIN y supervisores: derivaciones sin candidato que gestionar.
 * - Derivaciones visibles para el rol (ADMIN todas; el profesional las que
 *   origino o de fichas que trata) con su estado y candidatos.
 */
export function DerivacionesVista({ rol }: { rol: Rol }) {
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const gestiona = rol === 'ADMIN' || rol === 'PROFESIONAL';
  return (
    <div className="flex flex-col gap-4">
      {clinico && <OfertasParaMi rol={rol} />}
      {gestiona && <BandejaDerivaciones admin={rol === 'ADMIN'} />}
      {gestiona && <ListaDerivaciones rol={rol} />}
    </div>
  );
}

function OfertasParaMi({ rol }: { rol: Rol }) {
  const ofertas = useOfertasDerivacion(true);
  const [responder, setResponder] = useState<{ oferta: OfertaDerivacion; acepta: boolean } | null>(null);
  return (
    <Panel titulo="Ofertas de derivación para ti" bajada="Solo ves el motivo, la edad y el tipo de atención. Si aceptas, el paciente pasa a tu cargo.">
      <div className="mt-4">
        <EstadoConsulta consulta={ofertas} vacio={(l) => l.length === 0} textoVacio="No tienes ofertas abiertas">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {lista.map((o) => (
                <li key={o.derivacionId} className="rounded-lg border border-accent-500 bg-accent-100 px-[clamp(16px,2.6vw,22px)] py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[15px] font-black">
                        {o.tipoAtencion} · {o.edadPaciente} años
                      </p>
                      <p className="m-0 text-[12.5px] font-bold text-accent-800">Responde antes del {formatoFechaHora(o.venceEn)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => setResponder({ oferta: o, acepta: false })} className="!px-4 !py-2 !text-[13px]">
                        Rechazar
                      </Button>
                      <Button variant="team" icon="check" onClick={() => setResponder({ oferta: o, acepta: true })} className="!px-4 !py-2 !text-[13px]">
                        Aceptar
                      </Button>
                    </div>
                  </div>
                  {o.motivo && <p className="m-0 mt-2.5 text-[14px] font-semibold whitespace-pre-line text-pretty">{o.motivo}</p>}
                  {o.detalle && <p className="m-0 mt-1.5 text-[13px] font-semibold whitespace-pre-line text-neutral-800">{o.detalle}</p>}
                  {o.citasEnConflicto > 0 && (
                    <p className="m-0 mt-2 flex items-center gap-1.5 text-[12.5px] font-bold text-accent-800">
                      <Icon name="event_busy" size={16} />
                      {o.citasEnConflicto === 1 ? '1 hora del paciente choca con tu agenda' : `${o.citasEnConflicto} horas del paciente chocan con tu agenda`}:
                      quedan por reprogramar si aceptas.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </div>
      <Modal abierto={!!responder} onCerrar={() => setResponder(null)} titulo={responder?.acepta ? '¿Aceptar la derivación?' : '¿Rechazar la derivación?'}>
        {responder && <ResponderOferta {...responder} rol={rol} onListo={() => setResponder(null)} />}
      </Modal>
    </Panel>
  );
}

function ResponderOferta({ oferta, acepta, rol, onListo }: { oferta: OfertaDerivacion; acepta: boolean; rol: Rol; onListo: () => void }) {
  const cliente = useQueryClient();
  const responder = useMutation({
    mutationFn: () => datos(api.POST('/api/derivaciones/{id}/respuesta', { params: { path: { id: oferta.derivacionId } }, body: { acepta } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel'] });
      void cliente.invalidateQueries({ queryKey: ['notificaciones'] });
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        {acepta
          ? rol === 'PRACTICANTE'
            ? 'Se pide el consentimiento del paciente para que lo atienda un practicante supervisado. La ficha pasa a tu cargo cuando lo acepte.'
            : 'La ficha pasa a tu cargo ahora: el profesional de origen deja de verla y las horas que choquen con tu agenda quedan por reprogramar.'
          : 'La oferta pasa al siguiente candidato. Nadie sabrá que la rechazaste.'}
      </p>
      {responder.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(responder.error, 'No pudimos registrar tu respuesta.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Volver
        </Button>
        <Button variant="team" icon={acepta ? 'check' : 'close'} loading={responder.isPending} onClick={() => responder.mutate()}>
          {acepta ? 'Aceptar' : 'Rechazar'}
        </Button>
      </div>
    </div>
  );
}

/** Bandeja: solo ADMIN y supervisores vigentes la reciben (al resto la API responde 403 y no se muestra). */
function BandejaDerivaciones({ admin }: { admin: boolean }) {
  const pendientes = usePendientesDerivacion(true);
  const [proponer, setProponer] = useState<DerivacionPendiente | null>(null);
  const [gestionar, setGestionar] = useState<string | null>(null);
  if (pendientes.error instanceof ApiError && pendientes.error.status === 403) return null;
  return (
    <Panel
      titulo={admin ? 'Bandeja de derivaciones' : 'Bandeja de supervisión'}
      bajada={
        admin
          ? 'En curso o sin asignar. Solo motivo, edad y tipo: define candidatos o propone un practicante.'
          : 'Derivaciones que puedes ofrecer a un practicante que supervisas.'
      }
    >
      <div className="mt-4">
        <EstadoConsulta consulta={pendientes} vacio={(l) => l.length === 0} textoVacio="La bandeja está vacía">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col p-0">
              {lista.map((d) => (
                <li key={d.derivacionId} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                  <div className="min-w-0 flex-[1_1_260px]">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
                      {d.tipoAtencion} · {d.edadPaciente} años
                      <Badge tono={ESTADO_DERIVACION[d.estado].tono}>{ESTADO_DERIVACION[d.estado].texto}</Badge>
                    </p>
                    {d.motivo && <p className="m-0 line-clamp-2 text-[13px] font-semibold text-neutral-800">{d.motivo}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" icon="school" onClick={() => setProponer(d)} className="!px-4 !py-2 !text-[13px]">
                      Proponer practicante
                    </Button>
                    {admin && (
                      <Button variant="team" onClick={() => setGestionar(d.derivacionId)} className="!px-4 !py-2 !text-[13px]">
                        Gestionar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </div>
      <Modal abierto={!!proponer} onCerrar={() => setProponer(null)} titulo="Proponer practicante">
        {proponer && <ProponerPracticante derivacionId={proponer.derivacionId} admin={admin} onListo={() => setProponer(null)} />}
      </Modal>
      <Modal abierto={!!gestionar} onCerrar={() => setGestionar(null)} titulo="Gestionar derivación" ancho="lg">
        {gestionar && <DetalleDerivacion id={gestionar} admin onListo={() => setGestionar(null)} />}
      </Modal>
    </Panel>
  );
}

function ProponerPracticante({ derivacionId, admin, onListo }: { derivacionId: string; admin: boolean; onListo: () => void }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const equipo = useEquipoAgenda();
  const supervisiones = useSupervisiones();
  const [practicanteId, setPracticante] = useState('');
  // ADMIN propone a cualquier practicante con supervision vigente; el supervisor, a los suyos.
  const vigentes = (supervisiones.data ?? []).filter((s) => !s.hasta && (admin || s.supervisorId === cuenta.data?.id)).map((s) => s.practicanteId);
  const opciones = (equipo.data ?? []).filter((m) => m.roles.includes('PRACTICANTE') && vigentes.includes(m.id));
  const proponer = useMutation({
    mutationFn: () => datos(api.POST('/api/derivaciones/{id}/practicantes', { params: { path: { id: derivacionId } }, body: { practicanteId } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'derivaciones'] });
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        Se agrega al final de los candidatos. Si acepta, el paciente debe consentir la atención con un practicante supervisado.
      </p>
      <Field label="Practicante" required>
        {(p) => (
          <Select {...p} value={practicanteId} onChange={(e) => setPracticante(e.target.value)}>
            <option value="">{opciones.length ? 'Elige un practicante' : 'No hay practicantes con supervisión vigente'}</option>
            {opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre ?? 'Practicante'}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {proponer.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(proponer.error, 'No pudimos proponer al practicante.')}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" disabled={!practicanteId} loading={proponer.isPending} onClick={() => proponer.mutate()}>
          Proponer
        </Button>
      </div>
    </div>
  );
}

function ListaDerivaciones({ rol }: { rol: Rol }) {
  const [vista, setVista] = useState<'abiertas' | 'cerradas'>('abiertas');
  const derivaciones = useDerivacionesLista();
  const pacientes = usePacientes();
  const tipos = useTiposAtencion();
  const equipo = useEquipoAgenda();
  const nombre = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const nombrePaciente = nombresPacientes(pacientes.data);
  const tipo = new Map((tipos.data ?? []).map((t) => [t.id, t.nombre]));
  const [detalle, setDetalle] = useState<string | null>(null);
  const filtrar = (l: Derivacion[]) => l.filter((d) => ABIERTAS.includes(d.estado) === (vista === 'abiertas'));
  return (
    <Panel
      titulo={rol === 'ADMIN' ? 'Derivaciones del centro' : 'Mis derivaciones'}
      bajada="Las que originaste o de pacientes que atiendes. El detalle es texto clínico."
    >
      <div className="mt-4 flex flex-col gap-3">
        <Pestanas
          etiqueta="Estado"
          tono="team"
          valor={vista}
          onChange={setVista}
          pestanas={[
            { valor: 'abiertas', etiqueta: 'En curso' },
            { valor: 'cerradas', etiqueta: 'Cerradas' },
          ]}
        />
        <EstadoConsulta
          consulta={derivaciones}
          vacio={(l) => filtrar(l).length === 0}
          textoVacio={vista === 'abiertas' ? 'Ninguna en curso' : 'Ninguna cerrada'}
        >
          {(l) => (
            <ul className="m-0 flex list-none flex-col p-0">
              {filtrar(l).map((d) => {
                const e = ESTADO_DERIVACION[d.estado];
                const ofrecido = d.candidatos.find((c) => c.estado === 'OFRECIDA');
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-3 last:border-b-0">
                    <div className="min-w-0 flex-[1_1_260px]">
                      <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
                        {d.pacienteId ? (nombrePaciente.get(d.pacienteId) ?? 'Paciente') : 'Paciente traspasado'}
                        <Badge tono={e.tono}>{e.texto}</Badge>
                      </p>
                      <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                        {tipo.get(d.tipoAtencionId) ?? 'Tipo de atención'} · desde {nombre.get(d.profesionalOrigenId) ?? 'el tratante'} ·{' '}
                        {formatoFecha(d.fecha)}
                        {ofrecido ? ` · ofrecida a ${nombre.get(ofrecido.profesionalId) ?? 'un candidato'}` : ''}
                      </p>
                    </div>
                    <Button variant="secondary" onClick={() => setDetalle(d.id)} className="!px-4 !py-2 !text-[13px]">
                      Ver detalle
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
      </div>
      <Modal abierto={!!detalle} onCerrar={() => setDetalle(null)} titulo="Derivación" ancho="lg">
        {detalle && <DetalleDerivacion id={detalle} admin={rol === 'ADMIN'} onListo={() => setDetalle(null)} />}
      </Modal>
    </Panel>
  );
}

/**
 * Detalle con candidatos en orden. ADMIN redefine candidatos (vuelve a
 * ofrecer en ese orden), reintegra a uno que vencio o rechazo y cancela con
 * motivo; el origen puede cancelar mientras siga abierta.
 */
function DetalleDerivacion({ id, admin, onListo }: { id: string; admin: boolean; onListo: () => void }) {
  const cliente = useQueryClient();
  const cuenta = useMiCuenta();
  const consulta = useQuery({ queryKey: ['panel', 'derivacion', id], queryFn: () => datos(api.GET('/api/derivaciones/{id}', { params: { path: { id } } })) });
  const equipo = useEquipoAgenda();
  const tipos = useTiposAtencion();
  const nombre = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const [modo, setModo] = useState<'ver' | 'candidatos' | 'cancelar'>('ver');
  const [lista, setLista] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [motivo, setMotivo] = useState('');
  const refrescar = (d: Derivacion) => {
    cliente.setQueryData(['panel', 'derivacion', id], d);
    void cliente.invalidateQueries({ queryKey: ['panel', 'derivaciones'] });
    setModo('ver');
  };
  const candidatos = useMutation({
    mutationFn: () => datos(api.PUT('/api/derivaciones/{id}/candidatos', { params: { path: { id } }, body: { candidatos: lista } })),
    onSuccess: refrescar,
  });
  const reintegrar = useMutation({
    mutationFn: (profesionalId: string) =>
      datos(api.POST('/api/derivaciones/{id}/candidatos/{profesionalId}/reintegro', { params: { path: { id, profesionalId } } })),
    onSuccess: refrescar,
  });
  const cancelar = useMutation({
    mutationFn: () => datos(api.POST('/api/derivaciones/{id}/cancelacion', { params: { path: { id } }, body: { motivo: motivo.trim() } })),
    onSuccess: refrescar,
  });
  const error = candidatos.error ?? reintegrar.error ?? cancelar.error;
  return (
    <EstadoConsulta consulta={consulta}>
      {(d) => {
        const abierta = ABIERTAS.includes(d.estado);
        const puedeCancelar = abierta && (admin || d.profesionalOrigenId === cuenta.data?.id);
        const profesionales = (equipo.data ?? []).filter((m) => m.roles.includes('PROFESIONAL') && m.id !== d.profesionalOrigenId && !lista.includes(m.id));
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tono={ESTADO_DERIVACION[d.estado].tono}>{ESTADO_DERIVACION[d.estado].texto}</Badge>
              <span className="text-[13px] font-semibold text-neutral-800">
                {tipos.data?.find((t) => t.id === d.tipoAtencionId)?.nombre ?? 'Tipo de atención'} · creada el {formatoFecha(d.fecha)} por{' '}
                {nombre.get(d.profesionalOrigenId) ?? 'el tratante'}
              </span>
            </div>
            <div>
              <p className="m-0 mb-1 text-xs font-extrabold text-neutral-700">Motivo</p>
              <p className="m-0 text-[14.5px] font-semibold whitespace-pre-line text-pretty">{d.motivo}</p>
              {d.detalle && <p className="m-0 mt-2 text-[13.5px] font-semibold whitespace-pre-line text-neutral-800">{d.detalle}</p>}
              {d.motivoCierre && <p className="m-0 mt-2 text-[13px] font-bold text-neutral-800">Cierre: {d.motivoCierre}</p>}
            </div>
            {modo === 'candidatos' ? (
              <div className="flex flex-col gap-3 rounded-lg border border-accent-500 bg-accent-100 px-4 py-3.5">
                <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
                  Se ofrece en este orden, uno a la vez. Reemplaza a los candidatos que aún no responden.
                </p>
                <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {lista.map((p, i) => (
                    <li key={p} className="flex items-center justify-between gap-2 text-[14px] font-bold">
                      {i + 1}. {nombre.get(p) ?? 'Profesional'}
                      <button
                        type="button"
                        onClick={() => setLista((l) => l.filter((x) => x !== p))}
                        aria-label={`Quitar a ${nombre.get(p) ?? 'profesional'}`}
                        className="flex size-10 cursor-pointer items-center justify-center rounded-full text-accent-700 hover:bg-accent-200"
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Select aria-label="Agregar candidato" value={nuevo} onChange={(e) => setNuevo(e.target.value)} className="!max-w-[300px] !py-2.5">
                    <option value="">Agregar candidato</option>
                    {profesionales.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre ?? 'Profesional'}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    icon="add"
                    disabled={!nuevo}
                    onClick={() => {
                      setLista((l) => [...l, nuevo]);
                      setNuevo('');
                    }}
                    className="!py-2.5"
                  >
                    Agregar
                  </Button>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setModo('ver')}>
                    Volver
                  </Button>
                  <Button variant="team" disabled={lista.length === 0} loading={candidatos.isPending} onClick={() => candidatos.mutate()}>
                    Guardar y ofrecer
                  </Button>
                </div>
              </div>
            ) : modo === 'cancelar' ? (
              <div className="flex flex-col gap-3 rounded-lg border border-accent-500 bg-accent-100 px-4 py-3.5">
                <Field label="Motivo de la cancelación" required hint="El paciente sigue con su tratante actual.">
                  {(p) => <Textarea {...p} rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setModo('ver')}>
                    Volver
                  </Button>
                  <Button variant="team" disabled={motivo.trim().length < 3} loading={cancelar.isPending} onClick={() => cancelar.mutate()}>
                    Cancelar derivación
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="m-0 mb-1.5 text-xs font-extrabold text-neutral-700">Candidatos</p>
                {d.candidatos.length === 0 ? (
                  <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Sin candidatos: queda en la bandeja de administración.</p>
                ) : (
                  <ol className="m-0 flex list-none flex-col p-0">
                    {[...d.candidatos]
                      .sort((a, b) => a.orden - b.orden)
                      .map((c) => (
                        <li key={c.profesionalId} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider py-2.5 last:border-b-0">
                          <span className="text-[14px] font-bold">
                            {c.orden}. {nombre.get(c.profesionalId) ?? 'Profesional'}
                            <span className="ml-2 text-[12.5px] font-semibold text-neutral-700">
                              {ESTADO_CANDIDATO[c.estado]}
                              {c.estado === 'OFRECIDA' && c.venceEn ? ` hasta ${formatoFechaHora(c.venceEn)}` : ''}
                            </span>
                          </span>
                          {admin && abierta && (c.estado === 'EXPIRADA' || c.estado === 'RECHAZADA' || c.estado === 'OMITIDA') && (
                            <Button
                              variant="ghost"
                              loading={reintegrar.isPending && reintegrar.variables === c.profesionalId}
                              onClick={() => reintegrar.mutate(c.profesionalId)}
                              className="!px-3.5 !py-2 !text-[13px]"
                            >
                              Volver a ofrecer
                            </Button>
                          )}
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {textoError(error, 'No pudimos guardar el cambio.')}
              </p>
            )}
            {modo === 'ver' && (
              <div className="flex flex-wrap justify-between gap-2.5 border-t border-divider pt-4">
                <div className="flex flex-wrap gap-2">
                  {admin && abierta && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setLista(d.candidatos.filter((c) => c.estado === 'EN_ESPERA' || c.estado === 'OFRECIDA').map((c) => c.profesionalId));
                        setModo('candidatos');
                      }}
                    >
                      Definir candidatos
                    </Button>
                  )}
                  {puedeCancelar && (
                    <Button variant="ghost" onClick={() => setModo('cancelar')}>
                      Cancelar derivación
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {d.pacienteId && (
                    <ButtonLink href={`/admin/fichas/${d.pacienteId}`} variant="ghost">
                      Ver paciente
                    </ButtonLink>
                  )}
                  <Button variant="team" onClick={onListo}>
                    Listo
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      }}
    </EstadoConsulta>
  );
}
