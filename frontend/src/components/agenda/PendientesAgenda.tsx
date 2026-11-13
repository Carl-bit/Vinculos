'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Paginador, usePaginacion } from '@/components/ui/Paginador';
import { BarraSeleccion, CasillaFila, useSeleccion } from '@/components/ui/Seleccion';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { hoyChile, nombreDeCita, nombresPacientes, useCitas, useEquipoAgenda, usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

/**
 * Pestaña Pendientes: horas con pago pendiente (03b-3.2: se confirman con el
 * pago; si vence el plazo, se pagan en el centro) y citas por reprogramar (salida,
 * revocacion, baja o ausencia del profesional). Cada fila abre el detalle de la
 * sesion. Punto 24: por reprogramar se toman por grupos (seleccion multiple) con
 * acciones rapidas: avisar a los pacientes para que elijan o cancelar.
 */
export function PendientesAgenda({ rol, onElegir }: { rol: Rol; onElegir: (c: CitaVista) => void }) {
  const admin = esAdministracion(rol);
  const { profesionalId } = useEquipoActivo();
  const filtro = admin ? (profesionalId ?? undefined) : undefined;
  const porPagar = useCitas({ estado: 'PENDIENTE_PAGO', desde: hoyChile().desde, profesionalId: filtro });
  const porReprogramar = useQuery({ queryKey: ['panel', 'citas', 'por-reprogramar'], queryFn: () => datos(api.GET('/api/citas/por-reprogramar')) });
  const pacientes = usePacientes();
  const equipo = useEquipoAgenda();
  const nombres = nombresPacientes(pacientes.data);
  const profesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));

  const lista = (citas: CitaVista[], tono: 'atencion' | 'neutro', etiqueta: string, texto: (c: CitaVista) => string) => (
    <Tabla etiqueta={etiqueta}>
      <thead>
        <tr>
          <Th>Paciente</Th>
          <Th>Profesional</Th>
          <Th>Fecha</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {citas.map((c) => (
          <tr key={c.id} className="cursor-pointer transition-colors duration-200 hover:bg-accent-100" onClick={() => onElegir(c)}>
            <Td>
              <button type="button" onClick={() => onElegir(c)} className="cursor-pointer text-left text-[14.5px] font-extrabold hover:text-accent-700">
                {nombreDeCita(nombres, c)}
              </button>
            </Td>
            <Td className="font-semibold">{profesional.get(c.profesionalId) ?? 'Profesional'}</Td>
            <Td className="font-semibold text-neutral-800 first-letter:uppercase">
              {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)}
            </Td>
            <Td>
              <Badge tono={tono}>{texto(c)}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );

  return (
    <div className="flex flex-col gap-5">
      <Panel
        titulo="Pago pendiente"
        bajada="Se confirman con el pago (portal del paciente, transferencia validada o pago registrado en Cobros). Si vence el plazo sin pago, la que agendó el equipo se mantiene y se paga en el centro; la que pidió el paciente se libera."
      >
        <div className="mt-4">
          <EstadoConsulta consulta={porPagar} vacio={(l) => l.length === 0} textoVacio="No hay horas con pago pendiente">
            {(l) => lista(l, 'atencion', 'Pago pendiente', (c) => (c.pagoVenceEn ? `Hasta ${formatoFechaHora(c.pagoVenceEn)}` : 'Pago pendiente'))}
          </EstadoConsulta>
        </div>
      </Panel>
      <Panel
        titulo="Por reprogramar"
        bajada="El profesional no puede atender esas horas. Elige varias para avisar a los pacientes (eligen otra hora, cancelar o atenderse con otro profesional) o abre una para reprogramarla."
      >
        <div className="mt-4">
          <EstadoConsulta
            consulta={porReprogramar}
            vacio={(l) => l.filter((c) => !filtro || c.profesionalId === filtro).length === 0}
            textoVacio="No hay citas por reprogramar"
          >
            {(l) => (
              <PorReprogramar
                citas={l.filter((c) => !filtro || c.profesionalId === filtro)}
                rol={rol}
                nombres={nombres}
                profesional={profesional}
                onElegir={onElegir}
              />
            )}
          </EstadoConsulta>
        </div>
      </Panel>
    </div>
  );
}

function PorReprogramar({
  citas,
  rol,
  nombres,
  profesional,
  onElegir,
}: {
  citas: CitaVista[];
  rol: Rol;
  nombres: Map<string, string>;
  profesional: Map<string, string>;
  onElegir: (c: CitaVista) => void;
}) {
  const cliente = useQueryClient();
  const paginas = usePaginacion(citas, 'agenda-por-reprogramar');
  const seleccion = useSeleccion();
  const [resultado, setResultado] = useState<string>();
  const ids = [...seleccion.ids];
  const visibles = paginas.visibles.map((c) => c.id);
  const marcadas = visibles.filter((id) => seleccion.ids.has(id)).length;
  const listo = (texto: string) => {
    setResultado(texto);
    seleccion.limpiar();
    void cliente.invalidateQueries({ queryKey: ['panel', 'citas'] });
  };
  const avisar = useMutation({
    mutationFn: () => datos(api.POST('/api/citas/por-reprogramar/aviso', { body: { citas: ids } })),
    onSuccess: (r) => listo(r.avisadas === 1 ? 'Avisamos a 1 paciente.' : `Avisamos a ${r.avisadas} pacientes.`),
  });
  const cancelar = useMutation({
    mutationFn: async () => {
      for (const id of ids) await datos(api.PATCH('/api/citas/{id}/cancelacion', { params: { path: { id } } }));
    },
    onSuccess: () => listo(ids.length === 1 ? 'Cancelamos 1 hora.' : `Cancelamos ${ids.length} horas.`),
  });
  const error = avisar.error ?? cancelar.error;
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <BarraSeleccion
        cantidad={seleccion.ids.size}
        onLimpiar={() => {
          seleccion.limpiar();
          setConfirmarCancelar(false);
        }}
      >
        {rol !== 'PRACTICANTE' && (
          <Button variant="team" icon="send" loading={avisar.isPending} onClick={() => avisar.mutate()} className="!px-4 !py-2 !text-[13px]">
            Avisar a los pacientes
          </Button>
        )}
        {confirmarCancelar ? (
          <Button
            variant="secondary"
            icon="event_busy"
            loading={cancelar.isPending}
            onClick={() => cancelar.mutate()}
            className="!border-accent-700 !px-4 !py-2 !text-[13px] !text-accent-800"
          >
            Sí, cancelar {seleccion.ids.size}
          </Button>
        ) : (
          <Button variant="secondary" icon="event_busy" onClick={() => setConfirmarCancelar(true)} className="!px-4 !py-2 !text-[13px]">
            Cancelar seleccionadas
          </Button>
        )}
      </BarraSeleccion>
      {resultado && (
        <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
          {resultado}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error instanceof ApiError ? error.message : 'No pudimos completar la acción.'}
        </p>
      )}
      <Tabla etiqueta="Por reprogramar">
        <thead>
          <tr>
            <Th className="w-10">
              <CasillaFila
                etiqueta="Seleccionar las de esta página"
                marcada={visibles.length > 0 && marcadas === visibles.length}
                intermedia={marcadas > 0 && marcadas < visibles.length}
                onChange={(v) => seleccion.marcarPagina(visibles, v)}
              />
            </Th>
            <Th>Paciente</Th>
            <Th>Profesional</Th>
            <Th>Fecha</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {paginas.visibles.map((c) => (
            <tr key={c.id} className={seleccion.ids.has(c.id) ? 'bg-accent-2-100' : 'transition-colors duration-200 hover:bg-accent-100'}>
              <Td>
                <CasillaFila
                  etiqueta={`Seleccionar la hora de ${nombreDeCita(nombres, c)}`}
                  marcada={seleccion.ids.has(c.id)}
                  onChange={() => seleccion.alternar(c.id)}
                />
              </Td>
              <Td>
                <button type="button" onClick={() => onElegir(c)} className="cursor-pointer text-left text-[14.5px] font-extrabold hover:text-accent-700">
                  {nombreDeCita(nombres, c)}
                </button>
              </Td>
              <Td className="font-semibold">{profesional.get(c.profesionalId) ?? 'Profesional'}</Td>
              <Td className="font-semibold text-neutral-800 first-letter:uppercase">
                {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)}
              </Td>
              <Td>
                <Badge tono="neutro">Por reprogramar</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabla>
      <Paginador {...paginas} etiqueta="horas" />
    </div>
  );
}
