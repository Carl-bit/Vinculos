'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { textoConsentimiento, VERSION_PRACTICANTE, type TextoConsentimiento } from '@/lib/consentimientos';
import { formatoFechaHora, formatoFechaLarga } from '@/lib/formato';
import {
  nombresDe,
  useAvisosConsentimientoPortal,
  useConsentimientosPortal,
  useEquipoPortal,
  useMisDatos,
  useSupervisoresPortal,
  type AvisoConsentimiento,
  type Consentimiento,
} from '@/lib/portal';

const ESTADO: Record<Consentimiento['estado'], { texto: string; tono: TonoBadge }> = {
  SOLICITADO: { texto: 'Por responder', tono: 'atencion' },
  ACEPTADO: { texto: 'Aceptado', tono: 'positivo' },
  RECHAZADO: { texto: 'Rechazado', tono: 'neutro' },
  VENCIDO: { texto: 'Vencido', tono: 'neutro' },
  REVOCADO: { texto: 'Retirado', tono: 'neutro' },
};

type Pendiente =
  | { tipo: 'practicante'; c: Consentimiento; acepta: boolean; t: TextoConsentimiento }
  | { tipo: 'revocar'; c: Consentimiento; t: TextoConsentimiento }
  | { tipo: 'aviso'; a: AvisoConsentimiento; conforme: boolean; t: TextoConsentimiento };

/**
 * Consentimientos y avisos del portal (D-3): consentimiento informado de
 * atencion, atencion con practicante supervisado (responder o retirar) y
 * avisos de cambio de supervisor (conforme u oposicion). Responde el
 * paciente adulto o su adulto responsable (con su propio registro); cada
 * accion explica antes que pasa.
 */
export function ConsentimientosPortal() {
  const portal = usePortal();
  const cliente = useQueryClient();
  const consentimientos = useConsentimientosPortal(!portal.cargando);
  const avisos = useAvisosConsentimientoPortal(!portal.cargando);
  const equipo = useEquipoPortal();
  const supervisores = useSupervisoresPortal();
  const misDatos = useMisDatos(portal.pacienteParam, portal.responsable && !!portal.pacienteId);
  const nombres = nombresDe(equipo.data, supervisores.data);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [error, setError] = useState<string>();
  const [hecho, setHecho] = useState<string>();

  const otorgante = portal.responsable
    ? { otorgadoPorTipo: 'ADULTO_RESPONSABLE' as const, adultoResponsableId: misDatos.data?.adultosResponsables.find((a) => a.esMiCuenta)?.id }
    : { otorgadoPorTipo: 'PACIENTE' as const };

  const responder = useMutation({
    mutationFn: async (p: Pendiente) => {
      if (p.tipo === 'practicante')
        return datos(
          api.POST('/api/consentimientos/{id}/respuesta', {
            params: { path: { id: p.c.id } },
            body: { acepta: p.acepta, versionDocumento: p.acepta ? VERSION_PRACTICANTE : undefined, ...otorgante },
          }),
        );
      if (p.tipo === 'revocar') return datos(api.POST('/api/consentimientos/{id}/revocacion', { params: { path: { id: p.c.id } }, body: otorgante }));
      return datos(
        api.POST('/api/avisos-consentimiento/{id}/respuesta', {
          params: { path: { id: p.a.id } },
          body: { respuesta: p.conforme ? 'CONFORME' : 'OPOSICION', ...otorgante },
        }),
      );
    },
    onSuccess: (_r, p) => {
      setHecho(
        p.tipo === 'revocar'
          ? 'Retiraste el consentimiento.'
          : p.tipo === 'practicante'
            ? p.acepta
              ? p.t.acepta.consecuencia
              : p.t.rechaza.consecuencia
            : p.conforme
              ? p.t.acepta.consecuencia
              : p.t.rechaza.consecuencia,
      );
      setPendiente(null);
      void cliente.invalidateQueries({ queryKey: ['portal'] });
    },
    onError: (e) => {
      setPendiente(null);
      setError(e instanceof ApiError ? e.message : 'No pudimos registrar tu respuesta. Intenta de nuevo.');
    },
  });

  const delPaciente = (consentimientos.data ?? []).filter((c) => !portal.pacienteId || c.pacienteId === portal.pacienteId);
  const ids = new Set(delPaciente.map((c) => c.id));
  const avisosDelPaciente = (avisos.data ?? []).filter((a) => ids.has(a.consentimientoId));
  const textoDe = (c: Consentimiento, tipo: 'PRACTICANTE' | 'AVISO_SUPERVISOR' = 'PRACTICANTE', a?: AvisoConsentimiento) =>
    textoConsentimiento(tipo, {
      practicante: nombres.get(c.practicanteId),
      supervisor: nombres.get(a ? a.supervisorNuevoId : c.supervisorId),
      supervisorAnterior: a ? nombres.get(a.supervisorAnteriorId) : undefined,
      menor: portal.responsable,
    });

  return (
    <div className="flex flex-col gap-[18px]">
      {hecho && (
        <Aviso tono="exito" role="status" titulo="Registramos tu respuesta">
          {hecho}
        </Aviso>
      )}
      {error && (
        <Aviso tono="advertencia" role="alert">
          {error}
        </Aviso>
      )}
      <ConsentimientoAtencion />

      <Panel
        titulo="Atención con practicante supervisado"
        bajada="Un practicante en formación solo atiende con tu consentimiento. Puedes retirarlo cuando quieras."
      >
        <EstadoConsulta consulta={consentimientos} vacio={() => delPaciente.length === 0} textoVacio="No tienes consentimientos de practicante">
          {() => (
            <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
              {delPaciente.map((c) => {
                const t = textoDe(c);
                const e = ESTADO[c.estado];
                return (
                  <li key={c.id} className={`rounded-[18px] border bg-bg px-[18px] py-4 ${c.estado === 'SOLICITADO' ? 'border-accent-500' : 'border-divider'}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-[1_1_220px]">
                        <p className="m-0 text-[14.5px] font-black tracking-[-0.015em]">{nombres.get(c.practicanteId) ?? 'Practicante del centro'}</p>
                        <p className="m-0 text-[13px] font-semibold text-neutral-700">Supervisa {nombres.get(c.supervisorId) ?? 'un profesional del equipo'}</p>
                      </div>
                      <Badge tono={e.tono}>{e.texto}</Badge>
                    </div>
                    {c.estado === 'SOLICITADO' && (
                      <div className="mt-3.5 flex flex-col gap-3 border-t border-divider pt-3.5">
                        <p className="m-0 text-[13.5px] leading-relaxed font-semibold text-pretty">{t.resumen}</p>
                        <p className="m-0 text-[12.5px] font-bold text-neutral-700">Plazo para responder: {formatoFechaHora(c.venceEn)}</p>
                        <div className="flex flex-wrap gap-2.5">
                          <Button icon="check" onClick={() => setPendiente({ tipo: 'practicante', c, acepta: true, t })}>
                            Revisar y aceptar
                          </Button>
                          <Button variant="secondary" onClick={() => setPendiente({ tipo: 'practicante', c, acepta: false, t })}>
                            No acepto
                          </Button>
                        </div>
                      </div>
                    )}
                    {c.estado === 'ACEPTADO' && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="flex-1 text-[12.5px] font-bold text-neutral-700">
                          Aceptado el {c.respondidoEn ? formatoFechaLarga(c.respondidoEn) : formatoFechaLarga(c.solicitadoEn)}
                        </span>
                        <Button variant="ghost" onClick={() => setPendiente({ tipo: 'revocar', c, t })} className="!py-2">
                          Retirar consentimiento
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
      </Panel>

      {avisosDelPaciente.length > 0 && (
        <Panel titulo="Avisos de cambio de supervisor" bajada="Cuando cambia quien supervisa al practicante que te atiende, te avisamos y puedes oponerte.">
          <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
            {avisosDelPaciente.map((a) => {
              const c = delPaciente.find((x) => x.id === a.consentimientoId)!;
              const t = textoDe(c, 'AVISO_SUPERVISOR', a);
              const abierto = a.respuesta === 'SIN_RESPUESTA' && new Date(a.venceEn).getTime() > Date.now();
              return (
                <li key={a.id} className={`rounded-[18px] border bg-bg px-[18px] py-4 ${abierto ? 'border-accent-500' : 'border-divider'}`}>
                  <p className="m-0 mb-1 text-[14px] leading-relaxed font-bold text-pretty">{t.resumen}</p>
                  <p className="m-0 text-[12.5px] font-bold text-neutral-700">
                    {a.respuesta === 'CONFORME'
                      ? 'Respondiste que estás conforme.'
                      : a.respuesta === 'OPOSICION'
                        ? 'Te opusiste al cambio.'
                        : abierto
                          ? `Si no respondes antes del ${formatoFechaHora(a.venceEn)}, se entiende que estás conforme.`
                          : 'El plazo para responder terminó.'}
                  </p>
                  {abierto && (
                    <div className="mt-3 flex flex-wrap gap-2.5">
                      <Button icon="check" onClick={() => setPendiente({ tipo: 'aviso', a, conforme: true, t })}>
                        Estoy conforme
                      </Button>
                      <Button variant="secondary" onClick={() => setPendiente({ tipo: 'aviso', a, conforme: false, t })}>
                        Me opongo
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Modal
        abierto={!!pendiente}
        onCerrar={() => setPendiente(null)}
        ancho="lg"
        titulo={
          pendiente?.tipo === 'revocar'
            ? '¿Retirar el consentimiento?'
            : pendiente?.tipo === 'aviso'
              ? pendiente.conforme
                ? '¿Confirmas que estás conforme?'
                : '¿Confirmas tu oposición?'
              : pendiente?.acepta
                ? pendiente.t.titulo
                : '¿Confirmas que no aceptas?'
        }
        descripcion={
          pendiente?.tipo === 'revocar'
            ? 'Desde ahora el practicante deja de atenderte: tus horas futuras con él quedan por reprogramar y el centro te ofrecerá otro profesional. Tu ficha no se borra.'
            : pendiente?.tipo === 'practicante'
              ? pendiente.acepta
                ? pendiente.t.resumen
                : pendiente.t.rechaza.consecuencia
              : pendiente?.tipo === 'aviso'
                ? pendiente.conforme
                  ? pendiente.t.acepta.consecuencia
                  : pendiente.t.rechaza.consecuencia
                : undefined
        }
        acciones={
          pendiente && (
            <>
              <Button variant="ghost" onClick={() => setPendiente(null)}>
                Volver
              </Button>
              <Button
                variant={(pendiente.tipo === 'practicante' && pendiente.acepta) || (pendiente.tipo === 'aviso' && pendiente.conforme) ? 'primary' : 'team'}
                loading={responder.isPending}
                disabled={portal.responsable && !otorgante.adultoResponsableId}
                onClick={() => {
                  setError(undefined);
                  setHecho(undefined);
                  responder.mutate(pendiente);
                }}
              >
                {pendiente.tipo === 'revocar'
                  ? 'Sí, retirar'
                  : pendiente.tipo === 'aviso'
                    ? pendiente.conforme
                      ? 'Sí, estoy conforme'
                      : 'Sí, me opongo'
                    : pendiente.acepta
                      ? pendiente.t.acepta.boton
                      : 'Sí, no acepto'}
              </Button>
            </>
          )
        }
      >
        {pendiente?.tipo === 'practicante' && pendiente.acepta && (
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed font-semibold text-pretty">
            {pendiente.t.puntos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

/** Consentimiento informado de atencion: version vigente, si ya la acepto y, si no, el texto para aceptarla. */
function ConsentimientoAtencion() {
  const portal = usePortal();
  const cliente = useQueryClient();
  const estado = useQuery({
    queryKey: ['portal', 'consentimiento-atencion', portal.pacienteId ?? 'propio'],
    queryFn: () => datos(api.GET('/api/portal/consentimiento-atencion', { params: { query: { pacienteId: portal.pacienteParam } } })),
    enabled: !portal.cargando && !!portal.pacienteId,
  });
  const [leer, setLeer] = useState(false);
  const aceptar = useMutation({
    mutationFn: () => datos(api.POST('/api/portal/consentimiento-atencion', { body: { pacienteId: portal.pacienteParam } })),
    onSuccess: () => {
      setLeer(false);
      void cliente.invalidateQueries({ queryKey: ['portal', 'consentimiento-atencion'] });
    },
  });
  const t = textoConsentimiento('ATENCION', { menor: portal.responsable });

  return (
    <Panel titulo={t.titulo} bajada="Documento que explica cómo se realiza la atención, la confidencialidad y tus derechos como paciente.">
      <EstadoConsulta consulta={estado}>
        {(e) => {
          if (!e.vigente) return <p className="m-0 text-[13.5px] font-semibold text-neutral-700">El centro todavía no publica su consentimiento informado.</p>;
          const alDia = e.aceptada && e.aceptada.version >= e.vigente.version;
          return (
            <div className="flex flex-col gap-3.5">
              {alDia ? (
                <Aviso tono="exito" icono="task_alt">
                  Aceptaste la versión {e.aceptada!.version} el {formatoFechaLarga(e.aceptada!.aceptadaEn)}.
                </Aviso>
              ) : (
                <Aviso tono="advertencia" titulo={e.aceptada ? 'Hay una versión nueva' : 'Pendiente de aceptar'}>
                  {e.aceptada
                    ? `Aceptaste la versión ${e.aceptada.version}; el centro publicó la versión ${e.vigente.version}.`
                    : 'Antes de empezar la atención, el centro necesita que leas y aceptes este documento.'}
                </Aviso>
              )}
              <div>
                <Button variant={alDia ? 'secondary' : 'primary'} icon="description" onClick={() => setLeer(true)}>
                  {alDia ? 'Ver el documento' : 'Leer y aceptar'}
                </Button>
              </div>
              <Modal
                abierto={leer}
                onCerrar={() => setLeer(false)}
                ancho="lg"
                titulo={`${t.titulo} (versión ${e.vigente.version})`}
                acciones={
                  alDia ? (
                    <Button variant="secondary" onClick={() => setLeer(false)}>
                      Cerrar
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={() => setLeer(false)}>
                        Ahora no
                      </Button>
                      <Button icon="check" loading={aceptar.isPending} onClick={() => aceptar.mutate()}>
                        {t.acepta.boton}
                      </Button>
                    </>
                  )
                }
              >
                <div className="max-h-[50vh] overflow-y-auto rounded-[16px] border border-divider bg-neutral-100 px-5 py-4 text-[14.5px] leading-[1.7] whitespace-pre-line text-pretty">
                  {e.vigente.texto}
                </div>
                {!alDia && <p className="m-0 text-[13px] font-semibold text-neutral-700">{t.rechaza.consecuencia}</p>}
                {aceptar.error && (
                  <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                    {aceptar.error instanceof ApiError ? aceptar.error.message : 'No pudimos registrar tu aceptación.'}
                  </p>
                )}
              </Modal>
            </div>
          );
        }}
      </EstadoConsulta>
    </Panel>
  );
}
