'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';

type Plantilla = components['schemas']['PlantillaMensajeVista'];

const CANAL: Record<Plantilla['canal'], string> = { BANDEJA: 'Bandeja', CORREO: 'Correo', WHATSAPP: 'WhatsApp' };
const DESTINO: Record<Plantilla['destinatario'], string> = { PACIENTE: 'Paciente', EQUIPO: 'Equipo' };
/** Nombre legible del evento (TipoNotificacion): CITA_CONFIRMADA -> "Cita confirmada". */
const evento = (e: string) => e.charAt(0) + e.slice(1).toLowerCase().replaceAll('_', ' ');

/**
 * Plantillas de mensaje (diseño "Configuracion", Notificaciones): una por
 * evento, destinatario y canal. No se crean ni se borran: se personalizan o
 * se restaura el ejemplo. La bandeja no se desactiva (la BD lo impide). El
 * canal WhatsApp existe en el catalogo pero no se envia todavia. Las
 * variables son {{nombre}} (el diseño mostraba {paciente}).
 */
export function PlantillasMensaje() {
  const lista = useQuery({ queryKey: ['configuracion', 'plantillas'], queryFn: () => datos(api.GET('/api/plantillas-mensaje')) });
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <Panel
      titulo="Plantillas de mensaje"
      bajada="Variables: {{nombre_paciente}}, {{nombre_profesional}}, {{fecha}}, {{hora}}, {{modalidad}}, {{nombre_centro}} y {{enlace}}. Una variable sin valor queda vacía."
    >
      <div className="mt-4">
        <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Sin plantillas">
          {(l) => (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {l.map((p) => (
                <li key={p.id} className="rounded-[18px] border border-divider bg-bg">
                  <button
                    type="button"
                    aria-expanded={abierta === p.id}
                    onClick={() => setAbierta((a) => (a === p.id ? null : p.id))}
                    className="flex w-full cursor-pointer flex-wrap items-center gap-2.5 px-4 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1 text-[14px] font-extrabold">{evento(p.evento)}</span>
                    <Badge>{DESTINO[p.destinatario]}</Badge>
                    <Badge>{CANAL[p.canal]}</Badge>
                    {!p.activa && <Badge tono="neutro">Desactivada</Badge>}
                  </button>
                  {abierta === p.id && <Editor plantilla={p} />}
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}

function Editor({ plantilla }: { plantilla: Plantilla }) {
  const cliente = useQueryClient();
  const [asunto, setAsunto] = useState(plantilla.asunto);
  const [cuerpo, setCuerpo] = useState(plantilla.cuerpo);
  const [activa, setActiva] = useState(plantilla.activa);
  const [estado, setEstado] = useState<{ error?: string; ok?: string }>({});
  const refrescar = (ok: string) => (p: Plantilla) => {
    setAsunto(p.asunto);
    setCuerpo(p.cuerpo);
    setActiva(p.activa);
    setEstado({ ok });
    void cliente.invalidateQueries({ queryKey: ['configuracion', 'plantillas'] });
  };
  const fallo = (e: unknown) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar la plantilla.' });
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/plantillas-mensaje/{id}', { params: { path: { id: plantilla.id } }, body: { asunto: asunto.trim(), cuerpo: cuerpo.trim(), activa } }),
      ),
    onSuccess: refrescar('Plantilla guardada.'),
    onError: fallo,
  });
  const restaurar = useMutation({
    mutationFn: () => datos(api.POST('/api/plantillas-mensaje/{id}/restauracion', { params: { path: { id: plantilla.id } } })),
    onSuccess: refrescar('Se restauró el texto de ejemplo.'),
    onError: fallo,
  });
  return (
    <div className="flex flex-col gap-3.5 border-t border-divider px-4 py-4">
      <Field label="Asunto">{(x) => <Input {...x} value={asunto} maxLength={200} onChange={(e) => setAsunto(e.target.value)} />}</Field>
      <Field label="Mensaje">{(x) => <Textarea {...x} rows={5} maxLength={4000} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />}</Field>
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
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" loading={restaurar.isPending} onClick={() => restaurar.mutate()}>
          Restaurar ejemplo
        </Button>
        <Button variant="team" icon="save" disabled={!asunto.trim() || !cuerpo.trim()} loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar plantilla
        </Button>
      </div>
    </div>
  );
}
