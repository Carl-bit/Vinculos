'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { descargarArchivo } from '@/lib/descargas';
import { formatoFechaHora } from '@/lib/formato';

type Exportacion = components['schemas']['ExportacionCentroVista'];

const CLAVE = ['exportacion-centro'] as const;

const ESTADO: Record<Exportacion['estado'], { texto: string; tono: TonoBadge }> = {
  PENDIENTE: { texto: 'Programada', tono: 'pendiente' },
  EN_PROCESO: { texto: 'En proceso', tono: 'pendiente' },
  LISTA: { texto: 'Lista para descargar', tono: 'positivo' },
  FALLIDA: { texto: 'No se completó', tono: 'atencion' },
  DESCARGADA: { texto: 'Descargada', tono: 'neutro' },
  VENCIDA: { texto: 'Vencida', tono: 'neutro' },
};

const activa = (e: Exportacion) => e.estado === 'PENDIENTE' || e.estado === 'EN_PROCESO';
/** Consulta frecuente solo si va a avanzar pronto: en proceso, o urgente / reintento ya vencido. */
const avanzaPronto = (e: Exportacion) => e.estado === 'EN_PROCESO' || (e.estado === 'PENDIENTE' && new Date(e.programadaPara).getTime() <= Date.now() + 60_000);

const megas = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`;

/**
 * AUD-01 Fase 3 (LEG-04) y AUD-02: exportacion completa del centro, cifrada
 * con una clave que elige la cuenta madre. Por defecto se prepara en la
 * ventana nocturna del centro ("dentro de 24 horas"); "Preparar ahora" es para
 * urgencias (baja del centro). Avance en pantalla y aviso por correo. El
 * archivo cifrado queda en el servidor hasta descargarlo o 24 h; la clave no
 * se guarda (solo su llave publica, que cifra pero no abre), asi que sin ella
 * nadie lo abre, tampoco Vinculos. Un reinicio del servidor la retoma sola.
 * Polling (estandar_polling.md): 5 s solo mientras una avanza (en proceso o a
 * punto de partir) y la pestaña esta visible.
 */
export function ExportacionCentro() {
  const cliente = useQueryClient();
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<string>();
  const lista = useQuery({
    queryKey: CLAVE,
    queryFn: () => datos(api.GET('/api/exportacion-centro')),
    refetchInterval: (q) => (q.state.data?.some(avanzaPronto) ? 5_000 : false),
  });
  const pedir = useMutation({
    mutationFn: (urgente: boolean) => datos(api.POST('/api/exportacion-centro', { body: { clave, urgente } })),
    onSuccess: (e) => {
      setClave('');
      setRepetir('');
      setError(undefined);
      setAviso(
        e.urgente
          ? 'Estamos preparando la exportación ahora. Te avisaremos por correo cuando esté lista.'
          : 'La exportación estará lista dentro de 24 horas (se prepara fuera del horario de atención). Te avisaremos por correo.',
      );
      void cliente.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos iniciar la exportación.'),
  });
  const enCurso = lista.data?.some(activa) ?? false;

  const exportar = (urgente: boolean) => {
    if (clave.length < 16) return setError('La clave debe tener al menos 16 caracteres.');
    if (clave !== repetir) return setError('Las claves no coinciden.');
    setError(undefined);
    setAviso(undefined);
    pedir.mutate(urgente);
  };

  const bajar = async (e: Exportacion) => {
    setAviso(undefined);
    const r = await descargarArchivo(`/api/exportacion-centro/${e.id}/archivo`, 'exportacion-centro.vxp');
    if (r === 'listo') {
      setAviso(
        "Archivo descargado y borrado del servidor. Para abrirlo: CLAVE='tu clave' node descifrar.mjs archivo.vxp carpeta (script entregado por Vinculos; deja un JSON por tabla y un PDF por ficha).",
      );
      // El servidor la marca descargada al terminar el envio.
      setTimeout(() => void cliente.invalidateQueries({ queryKey: CLAVE }), 1_500);
    } else setAviso('No pudimos descargar el archivo. Si venció, pide una exportación nueva.');
  };

  return (
    <Panel
      titulo="Exportación completa del centro"
      bajada="Todos los datos del centro (pacientes, fichas, agenda, equipo, cobros, políticas y auditoría) en un archivo cifrado, para conservarlos o llevarlos a otro sistema."
    >
      <div className="mt-4 flex flex-col gap-4">
        <Aviso tono="nota" titulo="Guarda la clave en un lugar seguro">
          Vinculos no guarda la clave: sin ella nadie puede abrir el archivo, tampoco Vinculos. Se prepara fuera del horario de atención para no afectar al
          equipo y estará lista dentro de 24 horas; si es urgente (por ejemplo, la baja del centro), prepárala ahora. Te avisamos por correo y el archivo queda
          en el servidor hasta que lo descargues o 24 horas. Incluye las fichas clínicas: entrégalo solo a quien responde legalmente por ellas. Queda registrada
          en la auditoría.
        </Aviso>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clave" required hint="Al menos 16 caracteres. Una frase larga es más fácil de recordar.">
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />}
          </Field>
          <Field label="Repite la clave" required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" icon="bolt" loading={pedir.isPending && pedir.variables} disabled={enCurso} onClick={() => exportar(true)}>
            Preparar ahora (urgente)
          </Button>
          <Button variant="team" icon="schedule" loading={pedir.isPending && !pedir.variables} disabled={enCurso} onClick={() => exportar(false)}>
            Preparar dentro de 24 horas
          </Button>
        </div>
        {enCurso && <p className="m-0 text-right text-[12.5px] font-semibold text-neutral-700">Ya hay una exportación pedida: espera a que termine.</p>}
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        {aviso && (
          <Aviso tono="exito" role="status">
            {aviso}
          </Aviso>
        )}
        <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Todavía no hay exportaciones del centro">
          {(l) => (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Exportaciones del centro">
              {l.map((e) => {
                const total = e.tablasTotal + e.fichasTotal;
                const hechas = e.tablasHechas + e.fichasHechas;
                const pct = total ? Math.round((hechas / total) * 100) : 0;
                return (
                  <li key={e.id} className="flex flex-col gap-2 rounded-tarjeta border border-borde bg-bg px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[13.5px] font-extrabold">Pedida el {formatoFechaHora(e.creadaEn)}</span>
                      <Badge tono={ESTADO[e.estado].tono} className="ml-auto">
                        {ESTADO[e.estado].texto}
                      </Badge>
                    </div>
                    {e.estado === 'EN_PROCESO' && (
                      <div
                        role="progressbar"
                        aria-label="Avance de la exportación"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        className="h-2 overflow-hidden rounded-full bg-neutral-200"
                      >
                        <span className="block h-full bg-accent-700 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                      {e.estado === 'PENDIENTE' &&
                        (e.intentos > 0
                          ? `Se interrumpió y se retoma sola el ${formatoFechaHora(e.programadaPara)} (intento ${e.intentos + 1} de 3)`
                          : e.urgente
                            ? 'Partiendo ahora'
                            : `Se preparará el ${formatoFechaHora(e.programadaPara)}, fuera del horario de atención`)}
                      {e.estado === 'EN_PROCESO' &&
                        `${e.tablasHechas} de ${e.tablasTotal} tablas${e.fichasTotal ? ` · ${e.fichasHechas} de ${e.fichasTotal} fichas` : ''}`}
                      {e.estado === 'LISTA' && e.venceEn && `${e.bytes ? `${megas(e.bytes)} · ` : ''}Disponible hasta el ${formatoFechaHora(e.venceEn)}`}
                      {e.estado === 'DESCARGADA' && e.descargadaEn && `Descargada el ${formatoFechaHora(e.descargadaEn)}; ya no está en el servidor`}
                      {e.estado === 'FALLIDA' && e.motivoFallo}
                      {e.estado === 'VENCIDA' && 'Pasaron 24 horas sin descargarla: se borró del servidor'}
                    </p>
                    {e.estado === 'LISTA' &&
                      (e.propia ? (
                        <div>
                          <Button variant="team" icon="download" onClick={() => void bajar(e)}>
                            Descargar archivo cifrado
                          </Button>
                        </div>
                      ) : (
                        <p className="m-0 text-[12.5px] font-semibold text-neutral-700">La descarga quien la pidió (va cifrada con su clave).</p>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}
