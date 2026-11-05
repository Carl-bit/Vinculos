'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useProfesionales } from '@/lib/consultas';
import { formatoFechaHora, formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Bloque } from '@/lib/horarios';
import { usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { CuentaRegresiva } from './CuentaRegresiva';
import type { HoraElegida } from '@/lib/grillaAgenda';
import { NOMBRE_MODALIDAD_CITA, SelectorHorario } from './SelectorHorario';

interface Retencion {
  id: string;
  bloque: Bloque;
  desde: Date;
  hasta: Date;
}

/**
 * Agendar (o reprogramar) una sesion desde el backoffice (03_front.md): al
 * elegir una hora se retiene con un soft-lock (cuenta regresiva visible) y
 * solo al confirmar se crea la cita. Si otra persona gano la carrera (409 del
 * EXCLUDE), se muestra un mensaje claro y las alternativas de la API; nunca
 * se reintenta solo. La hora es con el tratante del paciente (otro
 * profesional: derivacion o "cubrir sesion"). 03b-3.2: con cobro previo
 * habilitado la cita nace pendiente de pago hasta el plazo del centro (lo
 * decide la BD). 03b-3.3: un paciente con deuda no agenda (422); ADMIN/GESTION
 * pueden autorizar la cita con motivo, sin perder la hora retenida. Desde
 * "Por box" llega una hora elegida: una hora libre del box se aparta para el
 * profesional al reservarla, y se libera si no se confirma.
 */
export function AgendarSesion({
  abierto,
  rol,
  onCerrar,
  pacienteInicial,
  reprogramar,
  horaElegida,
}: {
  abierto: boolean;
  rol: Rol;
  onCerrar: () => void;
  pacienteInicial?: string;
  /** Reprogramar una cita existente (mismo paciente y profesional). */
  reprogramar?: CitaVista;
  horaElegida?: HoraElegida;
}) {
  const cliente = useQueryClient();
  const pacientes = usePacientes({}, abierto);
  const profesionales = useProfesionales(true);
  const [pacienteId, setPacienteId] = useState(pacienteInicial ?? reprogramar?.pacienteId ?? '');
  const [retencion, setRetencion] = useState<Retencion | null>(null);
  const [alternativas, setAlternativas] = useState<{ inicio: string; fin: string }[]>([]);
  const [aviso, setAviso] = useState<string>();
  const [listo, setListo] = useState<CitaVista | null>(null);
  /** 03b-3.3: el paciente tiene deuda; ADMIN/GESTION pueden autorizar con motivo. */
  const [conDeuda, setConDeuda] = useState(false);
  const [motivoDeuda, setMotivoDeuda] = useState('');
  const autoriza = esAdministracion(rol);
  const alerta = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pacienteInicial) setPacienteId(pacienteInicial);
  }, [pacienteInicial]);
  useEffect(() => {
    if (aviso) alerta.current?.focus();
  }, [aviso]);

  const paciente = pacientes.data?.find((p) => p.id === pacienteId);
  const profesionalId = reprogramar?.profesionalId ?? paciente?.profesionalId ?? undefined;
  const nombreProfesional = profesionales.data?.find((p) => p.id === profesionalId)?.nombre ?? 'el profesional';
  // Con un profesional en foco solo se ofrecen sus pacientes: la hora es de el.
  const opcionesPaciente = pacientes.data?.filter((p) => !horaElegida?.profesionalId || p.profesionalId === horaElegida.profesionalId);
  const [usarHora, setUsarHora] = useState(!!horaElegida);
  // Bloque apartado aca para la hora elegida: si la cita no se confirma, se libera.
  const apartado = useRef<{ id: string; profesionalId: string } | null>(null);

  const liberarApartado = async () => {
    const a = apartado.current;
    apartado.current = null;
    if (!a) return;
    await datos(api.DELETE('/api/profesionales/{profesionalId}/bloques/{id}', { params: { path: a } })).catch(() => undefined);
    void cliente.invalidateQueries({ queryKey: ['panel', 'espacios'] });
  };
  const soltar = async () => {
    if (retencion) await datos(api.DELETE('/api/agenda/horarios-tomados/{id}', { params: { path: { id: retencion.id } } })).catch(() => undefined);
    setRetencion(null);
    await liberarApartado();
  };
  const cerrar = () => {
    void soltar();
    setAviso(undefined);
    setAlternativas([]);
    setListo(null);
    setConDeuda(false);
    setMotivoDeuda('');
    onCerrar();
  };

  // Retencion propia que sigue vigente (p. ej. tras recargar): se retoma con su cuenta regresiva.
  const retenidas = useQuery({
    queryKey: ['agenda', 'horarios-tomados'],
    queryFn: () => datos(api.GET('/api/agenda/horarios-tomados')),
    enabled: abierto && !!profesionalId && !reprogramar,
    staleTime: 0,
  });
  useEffect(() => {
    if (retencion || !retenidas.data) return;
    const propia = retenidas.data.find((h) => h.profesionalId === profesionalId && new Date(h.expiraEn).getTime() > Date.now());
    if (propia)
      setRetencion({
        id: propia.id,
        bloque: { modalidad: propia.modalidad, inicio: new Date(propia.inicio), fin: new Date(propia.fin) },
        desde: new Date(propia.createdAt),
        hasta: new Date(propia.expiraEn),
      });
    // Solo al llegar la lista: elegir otra hora despues no la vuelve a imponer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retenidas.data]);

  const tomar = useMutation({
    mutationFn: async (b: Bloque) => {
      const cuerpo = { profesionalId: profesionalId!, modalidad: b.modalidad, inicio: b.inicio.toISOString(), fin: b.fin.toISOString() };
      // Verificacion previa (opcion C), ANTES de retener: la propia retencion contaria como choque. Margen de
      // traslado, box y bloqueos. Al reprogramar la propia cita ocupa el horario: se omite y decide el EXCLUDE.
      const v = reprogramar ? null : await datos(api.POST('/api/citas/verificacion', { body: cuerpo }));
      if (v && !v.disponible) return { r: null, v };
      return { r: await datos(api.POST('/api/agenda/horarios-tomados', { body: cuerpo })), v };
    },
    onSuccess: ({ r, v }, b) => {
      setAviso(undefined);
      if (r) {
        setRetencion({ id: r.id, bloque: b, desde: new Date(), hasta: new Date(r.expiraEn) });
        return;
      }
      setAviso(`${nombreProfesional} no puede atender a esa hora (otra cita, un bloqueo o el margen de traslado). Te mostramos las horas libres más cercanas.`);
      setAlternativas(v?.alternativas ?? []);
      setUsarHora(false);
      void liberarApartado();
      void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
    },
    onError: (e) => {
      void liberarApartado();
      setAviso(
        e instanceof ApiError && e.status === 409
          ? 'Otra persona está reservando esa hora. Elige otra.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos retener la hora.',
      );
      void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
    },
  });

  const reservarHora = useMutation({
    mutationFn: async (h: HoraElegida) => {
      if (!h.apartar || !h.espacioId) return;
      const [b] = await datos(
        api.POST('/api/profesionales/{profesionalId}/bloques', {
          params: { path: { profesionalId: profesionalId! } },
          body: { bloques: [{ espacioId: h.espacioId, inicio: h.inicio.toISOString(), fin: h.fin.toISOString() }] },
        }),
      );
      if (b) apartado.current = { id: b.id, profesionalId: profesionalId! };
    },
    onSuccess: (_r, h) => {
      setAviso(undefined);
      tomar.mutate({ modalidad: h.espacioId ? 'PRESENCIAL' : 'ONLINE', inicio: h.inicio, fin: h.fin });
    },
    onError: (e) => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'espacios'] });
      setAviso(
        e instanceof ApiError && e.status === 409
          ? 'Alguien apartó esa hora recién. Elige otra.'
          : e instanceof ApiError
            ? e.message
            : 'No pudimos apartar la hora.',
      );
    },
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      const b = retencion!.bloque;
      const cuerpo = { modalidad: b.modalidad, inicio: b.inicio.toISOString(), fin: b.fin.toISOString() };
      return reprogramar
        ? datos(api.PATCH('/api/citas/{id}/reprogramacion', { params: { path: { id: reprogramar.id } }, body: cuerpo }))
        : datos(
            api.POST('/api/citas', {
              body: { ...cuerpo, pacienteId, profesionalId: profesionalId!, ...(conDeuda && { motivoAutorizacionDeuda: motivoDeuda.trim() }) },
            }),
          );
    },
    onSuccess: (c) => {
      apartado.current = null;
      setRetencion(null);
      setConDeuda(false);
      setMotivoDeuda('');
      setListo(c);
      void cliente.invalidateQueries({ queryKey: ['panel'] });
      void cliente.invalidateQueries({ queryKey: ['huecos'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setRetencion(null);
        void liberarApartado();
        setAlternativas(e.cuerpo.alternativas ?? []);
        setAviso('Alguien confirmó esa hora antes. Te mostramos las horas libres más cercanas; ninguna queda reservada hasta que la elijas.');
        void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
      } else if (e instanceof ApiError && e.cuerpo.restriccion === 'citas_paciente_moroso') {
        setConDeuda(true);
        setAviso(
          autoriza
            ? 'El paciente tiene sesiones anteriores con pago pendiente. Regularízalo en Cobros o autoriza esta hora indicando el motivo.'
            : 'El paciente tiene sesiones anteriores con pago pendiente: debe regularizar en el centro antes de agendar. Administración puede autorizar la hora.',
        );
      } else setAviso(e instanceof ApiError ? e.message : 'No pudimos crear la cita.');
    },
  });

  const elegirAlternativa = (a: { inicio: string; fin: string }) => {
    setAlternativas([]);
    tomar.mutate({ modalidad: retencion?.bloque.modalidad ?? 'PRESENCIAL', inicio: new Date(a.inicio), fin: new Date(a.fin) });
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      ancho="lg"
      titulo={listo ? (reprogramar ? 'Cita reprogramada' : 'Cita agendada') : reprogramar ? 'Reprogramar sesión' : 'Agendar sesión'}
      descripcion={listo ? undefined : 'Al elegir una hora la retenemos unos minutos para que nadie más la tome mientras confirmas.'}
    >
      {listo ? (
        <div className="flex flex-col gap-4">
          {listo.estado === 'PENDIENTE_PAGO' ? (
            <Aviso tono="advertencia" titulo={`${formatoFechaLarga(listo.inicio)}, ${formatoHora(listo.inicio)}: pago pendiente`}>
              {NOMBRE_MODALIDAD_CITA[listo.modalidad]} con {nombreProfesional}. Se confirma con el pago
              {listo.pagoVenceEn ? ` antes del ${formatoFechaHora(listo.pagoVenceEn)}` : ''}: le avisamos al paciente ahora y 48 y 24 horas antes. Paga desde su
              cuenta o se registra el pago en Cobros. Si vence el plazo sin pago, la hora se mantiene y se paga en el centro.
            </Aviso>
          ) : (
            <Aviso tono="exito" titulo={`${formatoFechaLarga(listo.inicio)}, ${formatoHora(listo.inicio)}`}>
              {NOMBRE_MODALIDAD_CITA[listo.modalidad]} con {nombreProfesional}. El paciente recibe la confirmación por correo.
              {!reprogramar && listo.medioConfirmacion === 'PAGO_EN_CENTRO' && ' Ya no queda plazo para el pago previo: se paga en el centro.'}
            </Aviso>
          )}
          <div className="flex justify-end">
            <Button variant="team" onClick={cerrar}>
              Listo
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {!reprogramar && (
            <Field label="Paciente" required>
              {(p) => (
                <Select
                  {...p}
                  value={pacienteId}
                  onChange={(e) => {
                    void soltar();
                    setConDeuda(false);
                    setAviso(undefined);
                    setPacienteId(e.target.value);
                  }}
                  disabled={!!retencion}
                >
                  <option value="">{pacientes.isPending ? 'Cargando pacientes…' : 'Elige un paciente'}</option>
                  {opcionesPaciente?.map((p2) => (
                    <option key={p2.id} value={p2.id}>
                      {p2.apellido}, {p2.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {paciente && !paciente.profesionalId && <Aviso tono="advertencia">El paciente no tiene profesional tratante: asígnalo antes de agendar.</Aviso>}
          {profesionalId && (
            <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
              Horas libres de <strong>{nombreProfesional}</strong>, dentro de sus horas de box apartadas.
            </p>
          )}
          {aviso && (
            <div ref={alerta} tabIndex={-1} className="outline-none">
              <Aviso tono="advertencia" role="alert">
                {aviso}
              </Aviso>
            </div>
          )}
          {alternativas.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {alternativas.map((a) => (
                <Button key={a.inicio} variant="secondary" onClick={() => elegirAlternativa(a)} className="!py-2.5">
                  {formatoFechaLarga(a.inicio)}, {formatoHora(a.inicio)}
                </Button>
              ))}
            </div>
          )}
          {retencion ? (
            <div className="flex flex-col gap-4 rounded-[18px] border border-accent-500 bg-accent-100 p-4">
              <div className="flex flex-wrap items-center gap-4">
                <CuentaRegresiva
                  desde={retencion.desde}
                  hasta={retencion.hasta}
                  onVencida={() => {
                    setRetencion(null);
                    void liberarApartado();
                    setAviso('Se acabó el tiempo de retención y la hora quedó libre. Elige de nuevo.');
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[12px] font-extrabold tracking-[0.08em] text-accent-800 uppercase">En proceso de reserva</p>
                  <p className="m-0 text-[16px] font-black tracking-[-0.02em] first-letter:uppercase">
                    {formatoFechaLarga(retencion.bloque.inicio)}, {formatoHora(retencion.bloque.inicio)} · {NOMBRE_MODALIDAD_CITA[retencion.bloque.modalidad]}
                  </p>
                </div>
              </div>
              {conDeuda && autoriza && (
                <Field label="Motivo para autorizar con deuda" hint="Queda registrado junto al saldo pendiente del paciente." required>
                  {(p) => <Textarea {...p} rows={2} maxLength={500} value={motivoDeuda} onChange={(e) => setMotivoDeuda(e.target.value)} />}
                </Field>
              )}
              <div className="flex flex-wrap justify-end gap-2.5">
                <Button variant="ghost" onClick={() => void soltar()}>
                  Elegir otra hora
                </Button>
                <Button
                  variant="team"
                  icon="check"
                  loading={confirmar.isPending}
                  disabled={conDeuda && (!autoriza || motivoDeuda.trim().length < 3)}
                  onClick={() => confirmar.mutate()}
                >
                  {reprogramar ? 'Confirmar nuevo horario' : conDeuda ? 'Autorizar y confirmar' : 'Confirmar cita'}
                </Button>
              </div>
            </div>
          ) : usarHora && horaElegida ? (
            <div className="flex flex-col gap-3">
              <Aviso tono="info" titulo={`${formatoFechaLarga(horaElegida.inicio)}, ${formatoHora(horaElegida.inicio)} · ${horaElegida.nombreBox}`}>
                {!horaElegida.espacioId
                  ? `Sesión online con ${profesionalId ? nombreProfesional : 'el profesional del paciente'}: no ocupa box.`
                  : horaElegida.apartar
                    ? `Al reservar, esta hora del box se aparta para ${profesionalId ? nombreProfesional : 'el profesional del paciente'}.`
                    : 'Hora sin sesión dentro de las horas de box apartadas.'}
              </Aviso>
              <div className="flex flex-wrap justify-end gap-2.5">
                {profesionalId && (
                  <Button variant="ghost" onClick={() => setUsarHora(false)}>
                    Ver otras horas
                  </Button>
                )}
                <Button
                  variant="team"
                  icon="event"
                  disabled={!profesionalId}
                  loading={reservarHora.isPending || tomar.isPending}
                  onClick={() => reservarHora.mutate(horaElegida)}
                >
                  Reservar esta hora
                </Button>
              </div>
            </div>
          ) : (
            profesionalId && (
              <SelectorHorario
                equipo
                profesionalId={profesionalId}
                valor={null}
                onElegir={(b) => tomar.mutate(b)}
                sinHoras={
                  <Aviso tono="info" titulo="Sin horas libres en las próximas semanas">
                    {nombreProfesional} no tiene horas de box apartadas libres. Aparta horas en «Horarios del equipo».
                  </Aviso>
                }
              />
            )
          )}
        </div>
      )}
    </Modal>
  );
}
