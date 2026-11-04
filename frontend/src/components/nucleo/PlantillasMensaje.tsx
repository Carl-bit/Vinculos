'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { DatosDisponibles } from '@/components/shared/DatosDisponibles';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Interruptor } from '@/components/ui/Interruptor';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { aDatosSimples, aVariables, datoInvalido, DATOS_MENSAJE } from '@/lib/variablesMensaje';

type Plantilla = components['schemas']['PlantillaMensajeVista'];

const CANAL: Record<Plantilla['canal'], string> = { BANDEJA: 'Bandeja', CORREO: 'Correo', WHATSAPP: 'WhatsApp' };
const DESTINO: Record<Plantilla['destinatario'], string> = { PACIENTE: 'Paciente', EQUIPO: 'Equipo' };
/** Nombre legible del evento (TipoNotificacion): CITA_CONFIRMADA -> "Cita confirmada". */
const evento = (e: string) => e.charAt(0) + e.slice(1).toLowerCase().replaceAll('_', ' ');

/** Nombre del evento como en el diseño; un evento nuevo cae al nombre derivado del enum. */
const NOMBRES: Record<string, string> = {
  CITA_CONFIRMADA: 'Cita confirmada',
  CITA_CANCELADA: 'Cita cancelada',
  CITA_REPROGRAMADA: 'Cita reprogramada',
  ENLACE_ONLINE: 'Enlace de la sesión online',
  RECORDATORIO_CITA: 'Recordatorio de cita',
  HORA_LIBERADA: 'Hora liberada',
  SOLICITUD_HORA: 'Solicitud de hora',
  CIERRE_REQUERIDO: 'Cierre requerido',
  POSIBLE_DUPLICADO: 'Posible duplicado',
  INSTRUCCIONES_TRANSFERENCIA: 'Instrucciones de transferencia',
  COMPROBANTE_RECIBIDO: 'Comprobante recibido',
  PAGO_VALIDADO: 'Pago validado',
  PAGO_RECHAZADO: 'Pago rechazado',
  PAGO_PENDIENTE: 'Pago pendiente',
  PAGO_REGISTRADO: 'Pago registrado',
  COMPROBANTE_EMITIDO: 'Comprobante emitido',
  DEUDA_PENDIENTE: 'Deuda pendiente',
  CONSENTIMIENTO_SOLICITADO: 'Consentimiento solicitado',
  CONSENTIMIENTO_POR_VENCER: 'Consentimiento por vencer',
  AVISO_CAMBIO_SUPERVISOR: 'Cambio de supervisor',
  DOCUMENTO_CLINICO: 'Documento clínico',
  ACCESO_CLINICO_TEMPORAL: 'Acceso clínico temporal',
  ACCESO_CLINICO_REVOCADO: 'Acceso clínico revocado',
  DERIVACION_OFRECIDA: 'Derivación ofrecida',
  DERIVACION_ACTUALIZADA: 'Derivación actualizada',
  MENSAJE_PACIENTE: 'Mensaje de paciente',
  MENSAJE_INTERNO: 'Mensaje interno',
};
const nombreEvento = (e: string) => NOMBRES[e] ?? evento(e);

const GRUPOS: { titulo: string; eventos: string[] }[] = [
  {
    titulo: 'Citas',
    eventos: [
      'CITA_CONFIRMADA',
      'CITA_CANCELADA',
      'CITA_REPROGRAMADA',
      'ENLACE_ONLINE',
      'RECORDATORIO_CITA',
      'HORA_LIBERADA',
      'SOLICITUD_HORA',
      'CIERRE_REQUERIDO',
      'POSIBLE_DUPLICADO',
    ],
  },
  {
    titulo: 'Pagos',
    eventos: [
      'INSTRUCCIONES_TRANSFERENCIA',
      'COMPROBANTE_RECIBIDO',
      'PAGO_VALIDADO',
      'PAGO_RECHAZADO',
      'PAGO_PENDIENTE',
      'PAGO_REGISTRADO',
      'COMPROBANTE_EMITIDO',
      'DEUDA_PENDIENTE',
    ],
  },
  {
    titulo: 'Clínico y consentimientos',
    eventos: [
      'CONSENTIMIENTO_SOLICITADO',
      'CONSENTIMIENTO_POR_VENCER',
      'AVISO_CAMBIO_SUPERVISOR',
      'DOCUMENTO_CLINICO',
      'ACCESO_CLINICO_TEMPORAL',
      'ACCESO_CLINICO_REVOCADO',
    ],
  },
  { titulo: 'Equipo', eventos: ['DERIVACION_OFRECIDA', 'DERIVACION_ACTUALIZADA', 'MENSAJE_PACIENTE', 'MENSAJE_INTERNO'] },
];

type Destino = `${Plantilla['destinatario']}-${Plantilla['canal']}`;
const COLUMNAS_BASE: Destino[] = ['PACIENTE-BANDEJA', 'PACIENTE-CORREO', 'EQUIPO-BANDEJA', 'EQUIPO-CORREO'];
const destinoDe = (p: Plantilla): Destino => `${p.destinatario}-${p.canal}`;
const textoDestino = (d: Destino) => {
  const [quien, canal] = d.split('-') as [Plantilla['destinatario'], Plantilla['canal']];
  return `${DESTINO[quien]} · ${CANAL[canal].toLowerCase()}`;
};
const editada = (p: Plantilla) => p.asunto !== p.asuntoEjemplo || p.cuerpo !== p.cuerpoEjemplo;

/** Valores de muestra para "Asi le llega" (ficticios, sin datos reales). */
const MUESTRA: Record<string, string> = {
  paciente: 'María José',
  profesional: 'Profesional Uno',
  fecha: 'jueves 12 de noviembre',
  hora: '11:00',
  modalidad: 'presencial, Box 1',
  centro: 'Centro de Prueba',
  enlace: 'centro-prueba.cl/portal',
};
const conMuestra = (t: string) => t.replace(/\{(\w+)\}/g, (o, k: string) => MUESTRA[k] ?? o);

/**
 * Plantillas de mensaje (diseño "Opcion A submenu agrupado", Avisos): una fila
 * por evento y una columna por destinatario y canal; la celda abre el editor
 * al costado. No se crean ni se borran: se personalizan o se restaura el
 * ejemplo ("Editada" = distinta del ejemplo). La bandeja no se desactiva (la
 * BD lo impide). El canal WhatsApp existe en el catalogo pero no se envia
 * todavia. Se escribe {paciente}; lib/variablesMensaje traduce a lo que guarda la API.
 */
export function PlantillasMensaje() {
  const lista = useQuery({ queryKey: ['configuracion', 'plantillas'], queryFn: () => datos(api.GET('/api/plantillas-mensaje')) });
  const [filtro, setFiltro] = useState<string>('Todos');
  const [elegida, setElegida] = useState<string | null>(null);
  const editor = useRef<HTMLElement>(null);
  /** Bajo 2xl el editor va arriba de la tabla: si quedo fuera de la vista, se trae. */
  const elegir = (id: string) => {
    setElegida(id);
    const caja = editor.current?.getBoundingClientRect();
    if (caja && caja.top < 0)
      editor.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Sin plantillas">
      {(l) => {
        const columnas = [...COLUMNAS_BASE, ...[...new Set(l.map(destinoDe))].filter((d) => !COLUMNAS_BASE.includes(d))];
        const conocidos = new Set(GRUPOS.flatMap((g) => g.eventos));
        const otros = [...new Set(l.map((p) => p.evento))].filter((e) => !conocidos.has(e));
        const grupos = [...GRUPOS, ...(otros.length ? [{ titulo: 'Otros', eventos: otros }] : [])]
          .map((g) => ({ ...g, eventos: g.eventos.filter((e) => l.some((p) => p.evento === e)) }))
          .filter((g) => g.eventos.length);
        const visibles = grupos.filter((g) => filtro === 'Todos' || g.titulo === filtro);
        const actual = l.find((p) => p.id === elegida) ?? l[0]!;
        const plantilla = (e: string, d: Destino) => l.find((p) => p.evento === e && destinoDe(p) === d);
        const columnasGrid = { gridTemplateColumns: `minmax(0, 2.2fr) repeat(${columnas.length}, minmax(0, 1fr))` };
        return (
          <div className="flex flex-col items-start gap-[18px] 2xl:flex-row">
            <section
              aria-label="Avisos"
              className="flex w-full min-w-0 flex-1 flex-col gap-2.5 rounded-lg border border-divider bg-neutral-100 p-[18px] shadow-sm"
            >
              <div role="group" aria-label="Filtrar avisos" className="flex flex-wrap gap-1.5">
                {['Todos', ...grupos.map((g) => g.titulo)].map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filtro === f}
                    onClick={() => setFiltro(f)}
                    className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-[13px] font-extrabold transition-colors duration-200 ease-out ${
                      filtro === f ? 'border-text bg-text text-neutral-100' : 'border-neutral-400 bg-bg text-text hover:border-accent-500'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="flex min-w-[620px] flex-col gap-1">
                  <div className="grid gap-1.5 px-2 pt-1.5 text-[12px] font-extrabold text-neutral-700" style={columnasGrid}>
                    <span>Aviso</span>
                    {columnas.map((d) => (
                      <span key={d} className="text-center">
                        {textoDestino(d)}
                      </span>
                    ))}
                  </div>
                  {visibles.map((g) => (
                    <div key={g.titulo} className="flex flex-col gap-1">
                      <p className="m-0 px-2 pt-2 pb-0.5 text-[11px] font-extrabold tracking-[0.1em] text-accent-700 uppercase">{g.titulo}</p>
                      {g.eventos.map((e) => (
                        <div key={e} className="grid items-center gap-1.5 px-2 py-0.5" style={columnasGrid}>
                          <span className="text-[14px] font-bold">{nombreEvento(e)}</span>
                          {columnas.map((d) => {
                            const p = plantilla(e, d);
                            if (!p)
                              return (
                                <span key={d} className="text-center text-neutral-500">
                                  <span aria-hidden="true">·</span>
                                  <span className="sr-only">No aplica</span>
                                </span>
                              );
                            const sel = p.id === actual.id;
                            const mod = editada(p);
                            return (
                              <button
                                key={d}
                                type="button"
                                aria-pressed={sel}
                                aria-label={`${nombreEvento(e)}, ${textoDestino(d).toLowerCase()}: ${mod ? 'editada' : 'ejemplo'}${p.activa ? '' : ', desactivada'}`}
                                onClick={() => elegir(p.id)}
                                className={`min-h-9 cursor-pointer rounded-[10px] text-[12px] font-extrabold transition-colors duration-200 ease-out ${
                                  sel
                                    ? 'border-2 border-accent-700 bg-accent-100'
                                    : mod
                                      ? 'border border-accent-2-500 bg-accent-2-200'
                                      : 'border border-divider bg-bg'
                                } ${mod ? 'text-accent-2-900' : 'text-neutral-800'} ${p.activa ? '' : 'line-through'}`}
                              >
                                {mod ? 'Editada' : 'Ejemplo'}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <aside
              aria-label="Editar plantilla"
              ref={editor}
              className="order-first flex w-full scroll-mt-4 flex-col gap-2.5 rounded-lg border border-divider bg-neutral-100 p-[18px] shadow-sm 2xl:sticky 2xl:top-4 2xl:order-none 2xl:w-[380px] 2xl:flex-none"
            >
              <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{textoDestino(destinoDe(actual))}</p>
              <h3 className="m-0 text-[18px] leading-tight font-black">{nombreEvento(actual.evento)}</h3>
              <Editor key={`${actual.id}-${actual.updatedAt}`} plantilla={actual} />
            </aside>
          </div>
        );
      }}
    </EstadoConsulta>
  );
}

function Editor({ plantilla }: { plantilla: Plantilla }) {
  const cliente = useQueryClient();
  const [asunto, setAsunto] = useState(aDatosSimples(plantilla.asunto));
  const [cuerpo, setCuerpo] = useState(aDatosSimples(plantilla.cuerpo));
  const [activa, setActiva] = useState(plantilla.activa);
  const [estado, setEstado] = useState<{ error?: string; ok?: string }>({});
  const refrescar = (ok: string) => (p: Plantilla) => {
    setAsunto(aDatosSimples(p.asunto));
    setCuerpo(aDatosSimples(p.cuerpo));
    setActiva(p.activa);
    setEstado({ ok });
    void cliente.invalidateQueries({ queryKey: ['configuracion', 'plantillas'] });
  };
  const fallo = (e: unknown) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar la plantilla.' });
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/plantillas-mensaje/{id}', {
          params: { path: { id: plantilla.id } },
          body: { asunto: aVariables(asunto.trim(), DATOS_MENSAJE), cuerpo: aVariables(cuerpo.trim(), DATOS_MENSAJE), activa },
        }),
      ),
    onSuccess: refrescar('Plantilla guardada.'),
    onError: fallo,
  });
  const enviar = () => {
    const invalido = datoInvalido(`${asunto} ${cuerpo}`, DATOS_MENSAJE);
    if (invalido) setEstado({ error: invalido });
    else guardar.mutate();
  };
  const restaurar = useMutation({
    mutationFn: () => datos(api.POST('/api/plantillas-mensaje/{id}/restauracion', { params: { path: { id: plantilla.id } } })),
    onSuccess: refrescar('Se restauró el texto de ejemplo.'),
    onError: fallo,
  });
  return (
    <div className="flex flex-col gap-3">
      <Field label="Asunto">{(x) => <Input {...x} value={asunto} maxLength={200} onChange={(e) => setAsunto(e.target.value)} />}</Field>
      <Field label="Mensaje">{(x) => <Textarea {...x} rows={5} maxLength={4000} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />}</Field>
      <DatosDisponibles datos={DATOS_MENSAJE} onElegir={(v) => setCuerpo((t) => `${t}${t.endsWith('\n') || !t ? '' : ' '}${v}`)} />
      <div className="flex flex-col gap-1 rounded-[12px] bg-neutral-200 p-3">
        <span className="text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Así le llega</span>
        <span className="text-[13px] font-semibold whitespace-pre-line">{conMuestra(cuerpo)}</span>
      </div>
      {plantilla.canal !== 'BANDEJA' && (
        <Interruptor
          tono="team"
          etiqueta="Enviar este aviso"
          descripcion="Desactivada, este aviso no se envía por este canal."
          activo={activa}
          onChange={setActiva}
        />
      )}
      {plantilla.canal === 'WHATSAPP' && (
        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">El envío por WhatsApp todavía no está disponible: la plantilla queda lista.</p>
      )}
      {estado.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {estado.error}
        </p>
      )}
      {estado.ok && !estado.error && (
        <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
          {estado.ok}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" loading={restaurar.isPending} onClick={() => restaurar.mutate()}>
          Restaurar ejemplo
        </Button>
        <Button variant="team" icon="save" disabled={!asunto.trim() || !cuerpo.trim()} loading={guardar.isPending} onClick={enviar}>
          Guardar plantilla
        </Button>
      </div>
    </div>
  );
}
