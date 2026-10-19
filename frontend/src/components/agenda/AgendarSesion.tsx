'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useProfesionales } from '@/lib/consultas';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Bloque } from '@/lib/horarios';
import { usePacientes, type CitaVista } from '@/lib/panel';

import { CuentaRegresiva } from './CuentaRegresiva';
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
 * profesional: derivacion o "cubrir sesion").
 */
export function AgendarSesion({
  abierto,
  onCerrar,
  pacienteInicial,
  reprogramar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  pacienteInicial?: string;
  /** Reprogramar una cita existente (mismo paciente y profesional). */
  reprogramar?: CitaVista;
}) {
  const cliente = useQueryClient();
  const pacientes = usePacientes({}, abierto);
  const profesionales = useProfesionales(true);
  const [pacienteId, setPacienteId] = useState(pacienteInicial ?? reprogramar?.pacienteId ?? '');
  const [retencion, setRetencion] = useState<Retencion | null>(null);
  const [alternativas, setAlternativas] = useState<{ inicio: string; fin: string }[]>([]);
  const [aviso, setAviso] = useState<string>();
  const [listo, setListo] = useState<CitaVista | null>(null);
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

  const soltar = async () => {
    if (retencion) await datos(api.DELETE('/api/agenda/horarios-tomados/{id}', { params: { path: { id: retencion.id } } })).catch(() => undefined);
    setRetencion(null);
  };
  const cerrar = () => {
    void soltar();
    setAviso(undefined);
    setAlternativas([]);
    setListo(null);
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
      void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
    },
    onError: (e) => {
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

  const confirmar = useMutation({
    mutationFn: async () => {
      const b = retencion!.bloque;
      const cuerpo = { modalidad: b.modalidad, inicio: b.inicio.toISOString(), fin: b.fin.toISOString() };
      return reprogramar
        ? datos(api.PATCH('/api/citas/{id}/reprogramacion', { params: { path: { id: reprogramar.id } }, body: cuerpo }))
        : datos(api.POST('/api/citas', { body: { ...cuerpo, pacienteId, profesionalId: profesionalId! } }));
    },
    onSuccess: (c) => {
      setRetencion(null);
      setListo(c);
      void cliente.invalidateQueries({ queryKey: ['panel'] });
      void cliente.invalidateQueries({ queryKey: ['huecos'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setRetencion(null);
        setAlternativas(e.cuerpo.alternativas ?? []);
        setAviso('Alguien confirmó esa hora antes. Te mostramos las horas libres más cercanas; ninguna queda reservada hasta que la elijas.');
        void cliente.invalidateQueries({ queryKey: ['huecos', profesionalId] });
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
          <Aviso tono="exito" titulo={`${formatoFechaLarga(listo.inicio)}, ${formatoHora(listo.inicio)}`}>
            {NOMBRE_MODALIDAD_CITA[listo.modalidad]} con {nombreProfesional}. El paciente recibe la confirmación por correo.
          </Aviso>
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
                    setPacienteId(e.target.value);
                  }}
                  disabled={!!retencion}
                >
                  <option value="">{pacientes.isPending ? 'Cargando pacientes…' : 'Elige un paciente'}</option>
                  {pacientes.data?.map((p2) => (
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
              <div className="flex flex-wrap justify-end gap-2.5">
                <Button variant="ghost" onClick={() => void soltar()}>
                  Elegir otra hora
                </Button>
                <Button variant="team" icon="check" loading={confirmar.isPending} onClick={() => confirmar.mutate()}>
                  {reprogramar ? 'Confirmar nuevo horario' : 'Confirmar cita'}
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
