'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ADVERTENCIA_TEXTO_LIBRE, FormularioDinamico, faltantes, type ValoresPlantilla } from '@/components/shared/FormularioDinamico';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import {
  NIVEL_RIESGO,
  useEstadosAvance,
  useIntervenciones,
  usePlantillasAplicables,
  useTiposSesion,
  type BorradorVista,
  type EvolucionVista,
  type NivelRiesgo,
} from '@/lib/fichas';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { CitaVista } from '@/lib/panel';

const MAX_NOTAS = 20_000;
const ESPERA_GUARDADO = 1200;

type EstadoGuardado = 'vacio' | 'pendiente' | 'guardando' | 'guardado' | 'error';

interface Estructurados {
  tipoSesionId: string;
  nivelRiesgo: NivelRiesgo | '';
  estadoAvanceId: string;
  intervencionIds: string[];
}

interface EditorEvolucionProps {
  fichaId: string;
  /** Sesiones realizadas sin evolucion (para elegir cual se cierra). */
  sesiones: readonly CitaVista[];
  borrador?: BorradorVista;
  citaInicial?: string;
  /** Correccion: registro nuevo que apunta a este (no pasa por borrador). */
  corrige?: EvolucionVista;
  onListo: () => void;
}

/**
 * Nueva evolucion (borrador con guardado automatico) o correccion de una
 * evolucion propia. El borrador guarda notas, sesion, plantilla y valores; los
 * campos estructurados se eligen al "Confirmar en el expediente", porque
 * desde ahi el registro ya no se edita (solo se corrige con uno nuevo).
 */
export function EditorEvolucion({ fichaId, sesiones, borrador, citaInicial, corrige, onListo }: EditorEvolucionProps) {
  const cliente = useQueryClient();
  const plantillas = usePlantillasAplicables('EVOLUCION');
  const [notas, setNotas] = useState(corrige?.notas ?? borrador?.contenido ?? '');
  const [citaId, setCitaId] = useState(corrige ? '' : (borrador?.citaId ?? citaInicial ?? ''));
  const [plantillaId, setPlantillaId] = useState(corrige?.plantilla?.id ?? borrador?.plantillaId ?? '');
  const [valores, setValores] = useState<ValoresPlantilla>((corrige?.valores ?? borrador?.valores ?? {}) as ValoresPlantilla);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [descartar, setDescartar] = useState(false);
  const [estructurados, setEstructurados] = useState<Estructurados>({
    tipoSesionId: corrige?.tipoSesion?.id ?? '',
    nivelRiesgo: corrige?.nivelRiesgo ?? '',
    estadoAvanceId: corrige?.estadoAvance?.id ?? '',
    intervencionIds: corrige?.intervenciones.map((i) => i.id) ?? [],
  });

  // La plantilla de una correccion es la del registro corregido (la BD lo exige).
  const plantilla = corrige?.plantilla ?? plantillas.lista.find((p) => p.id === plantillaId);
  const campos = plantilla?.definicion ?? [];
  // El aviso de texto libre ya acompaña a esos campos de la plantilla: en las notas no se repite entero.
  const avisoEnPlantilla = campos.some((c) => c.es_texto_libre);

  // --- Guardado automatico del borrador (no aplica a una correccion) ---
  const idBorrador = useRef(borrador?.id);
  const ultimoGuardado = useRef(
    borrador
      ? JSON.stringify(cuerpoBorrador(borrador.contenido, borrador.citaId ?? '', borrador.plantillaId ?? '', (borrador.valores ?? {}) as ValoresPlantilla))
      : '',
  );
  const cola = useRef<Promise<void>>(Promise.resolve());
  const [guardado, setGuardado] = useState<EstadoGuardado>(borrador ? 'guardado' : 'vacio');
  const [errorGuardado, setErrorGuardado] = useState<string>();

  const persistir = (cuerpo: ReturnType<typeof cuerpoBorrador>) => {
    const json = JSON.stringify(cuerpo);
    cola.current = cola.current.then(async () => {
      if (json === ultimoGuardado.current) return;
      setGuardado('guardando');
      try {
        const b = idBorrador.current
          ? await datos(api.PUT('/api/borradores/{id}', { params: { path: { id: idBorrador.current } }, body: cuerpo }))
          : await datos(api.POST('/api/fichas/{fichaId}/borradores', { params: { path: { fichaId } }, body: cuerpo }));
        idBorrador.current = b.id;
        ultimoGuardado.current = json;
        setGuardado('guardado');
        setErrorGuardado(undefined);
        void cliente.invalidateQueries({ queryKey: ['borradores'] });
      } catch (e) {
        setGuardado('error');
        setErrorGuardado(e instanceof ApiError ? e.message : 'No pudimos guardar el borrador. Revisa tu conexión.');
      }
    });
    return cola.current;
  };

  useEffect(() => {
    if (corrige) return;
    if (!notas.trim()) {
      setGuardado(idBorrador.current ? 'pendiente' : 'vacio');
      return;
    }
    const cuerpo = cuerpoBorrador(notas, citaId, plantillaId, valores);
    if (JSON.stringify(cuerpo) === ultimoGuardado.current) return;
    setGuardado('pendiente');
    const t = setTimeout(() => void persistir(cuerpo), ESPERA_GUARDADO);
    return () => clearTimeout(t);
    // persistir usa refs: solo los datos del borrador disparan el guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, citaId, plantillaId, valores, corrige]);

  const tipos = useTiposSesion('APROBADO');
  const estados = useEstadosAvance();
  const intervenciones = useIntervenciones();

  const invalidar = () => {
    void cliente.invalidateQueries({ queryKey: ['panel', 'evoluciones', fichaId] });
    void cliente.invalidateQueries({ queryKey: ['borradores'] });
    void cliente.invalidateQueries({ queryKey: ['panel', 'estado-fichas'] });
    void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
  };

  const registrar = useMutation({
    mutationFn: async () => {
      const e = estructurados;
      const campos = {
        tipoSesionId: e.tipoSesionId,
        nivelRiesgo: e.nivelRiesgo as NivelRiesgo,
        estadoAvanceId: e.estadoAvanceId || undefined,
        intervencionIds: e.intervencionIds.length ? e.intervencionIds : undefined,
      };
      if (corrige) {
        return datos(
          api.POST('/api/fichas/{fichaId}/evoluciones', {
            params: { path: { fichaId } },
            body: { ...campos, notas: notas.trim(), corrigeAId: corrige.id, plantillaId: plantilla?.id, valores: plantilla ? valores : undefined },
          }),
        );
      }
      // Lo ultimo escrito queda en el borrador antes de confirmarlo.
      await persistir(cuerpoBorrador(notas, citaId, plantillaId, valores));
      if (!idBorrador.current) throw new Error('sin-borrador');
      return datos(api.POST('/api/borradores/{id}/confirmacion', { params: { path: { id: idBorrador.current } }, body: campos }));
    },
    onSuccess: () => {
      invalidar();
      onListo();
    },
  });

  const quitar = useMutation({
    mutationFn: () => datos(api.DELETE('/api/borradores/{id}', { params: { path: { id: idBorrador.current! } } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['borradores'] });
      onListo();
    },
  });

  const abrirConfirmacion = () => {
    const f = faltantes(campos, valores);
    if (!notas.trim()) f.notas = 'Escribe las notas de la sesión.';
    setErrores(f);
    if (Object.keys(f).length === 0) setConfirmar(true);
  };

  const listoParaConfirmar = !!estructurados.tipoSesionId && !!estructurados.nivelRiesgo;

  return (
    <>
      <Panel
        variante="equipo"
        titulo={corrige ? 'Corregir evolución' : 'Nueva evolución'}
        bajada={
          corrige
            ? `Corriges el registro del ${formatoFechaLarga(corrige.createdAt)}. El original se conserva y queda enlazado a la corrección.`
            : 'Se guarda solo como borrador mientras escribes. Pasa al expediente cuando lo confirmes.'
        }
        accion={!corrige && <IndicadorGuardado estado={guardado} />}
      >
        <div className="flex flex-col gap-4">
          {corrige && (
            <p className="m-0 flex items-start gap-2 text-[13px] font-bold text-accent-800">
              <Icon name="history" size={18} className="flex-none" />
              La corrección no se guarda como borrador: si cierras esta sección antes de registrarla, se pierde.
            </p>
          )}
          {!corrige && (
            <Field label="Sesión que cierra" hint="Opcional. Solo sesiones realizadas que aún no tienen evolución.">
              {(p) => (
                <Select {...p} value={citaId} onChange={(e) => setCitaId(e.target.value)}>
                  <option value="">Sin sesión asociada</option>
                  {sesiones.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatoFechaLarga(s.inicio)}, {formatoHora(s.inicio)} · {s.modalidad === 'ONLINE' ? 'Online' : 'Presencial'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {corrige ? (
            plantilla && (
              <p className="m-0 text-[12.5px] font-extrabold text-neutral-700">
                Plantilla: {plantilla.nombre}, versión {plantilla.version} (la del registro que corriges)
              </p>
            )
          ) : (
            <Field
              label="Plantilla de evolución"
              hint={
                plantillas.lista.length
                  ? 'Las publicadas para tus especialidades aprobadas.'
                  : 'No hay plantillas publicadas para tus especialidades: puedes registrar solo las notas.'
              }
            >
              {(p) => (
                <Select
                  {...p}
                  value={plantillaId}
                  onChange={(e) => {
                    setPlantillaId(e.target.value);
                    setValores({});
                    setErrores({});
                  }}
                >
                  <option value="">Sin plantilla (solo notas)</option>
                  {plantillas.lista.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.nombre} · versión {pl.version}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {campos.length > 0 && <FormularioDinamico campos={campos} valores={valores} onChange={setValores} errores={errores} />}
          <Field
            label="Notas de la sesión"
            required
            hint={avisoEnPlantilla ? 'También es texto libre: sin datos identificatorios.' : ADVERTENCIA_TEXTO_LIBRE}
            error={errores.notas}
          >
            {(p) => <Textarea {...p} rows={8} maxLength={MAX_NOTAS} value={notas} onChange={(e) => setNotas(e.target.value)} className="!min-h-44" />}
          </Field>
          {errorGuardado && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {errorGuardado}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-divider pt-4">
            {!corrige && idBorrador.current ? (
              <Button variant="ghost" icon="delete" onClick={() => setDescartar(true)}>
                Descartar borrador
              </Button>
            ) : (
              <Button variant="ghost" onClick={onListo}>
                {corrige ? 'Cancelar' : 'Cerrar'}
              </Button>
            )}
            <Button variant="team" icon="task_alt" onClick={abrirConfirmacion}>
              {corrige ? 'Registrar corrección' : 'Confirmar en el expediente'}
            </Button>
          </div>
        </div>
      </Panel>
      <Modal
        abierto={confirmar}
        onCerrar={() => setConfirmar(false)}
        ancho="lg"
        titulo={corrige ? 'Registrar corrección' : 'Confirmar en el expediente'}
        descripcion={
          corrige
            ? 'Queda como un registro nuevo enlazado al original. Ninguno de los dos se puede editar ni borrar después.'
            : 'Al confirmar, la evolución pasa al expediente y ya no se edita ni se borra: un error se corrige con un registro nuevo. El borrador se elimina.'
        }
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmar(false)}>
              Volver a editar
            </Button>
            <Button variant="team" icon="task_alt" loading={registrar.isPending} disabled={!listoParaConfirmar} onClick={() => registrar.mutate()}>
              {corrige ? 'Registrar corrección' : 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Tipo de sesión" required hint="Solo tipos aprobados por administración. Puedes proponer uno nuevo en Fichas › Catálogos clínicos.">
            {(p) => (
              <Select {...p} value={estructurados.tipoSesionId} onChange={(e) => setEstructurados({ ...estructurados, tipoSesionId: e.target.value })}>
                <option value="">Elige el tipo de sesión</option>
                {(tipos.data ?? [])
                  .filter((t) => t.activo || t.id === estructurados.tipoSesionId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <ChoiceGroup
            legend="Nivel de riesgo"
            type="radio"
            required
            options={(Object.keys(NIVEL_RIESGO) as NivelRiesgo[]).map((n) => ({ value: n, label: NIVEL_RIESGO[n].texto }))}
            value={estructurados.nivelRiesgo ? [estructurados.nivelRiesgo] : []}
            onChange={(v) => setEstructurados({ ...estructurados, nivelRiesgo: (v[0] as NivelRiesgo) ?? '' })}
          />
          <Field label="Estado de avance">
            {(p) => (
              <Select {...p} value={estructurados.estadoAvanceId} onChange={(e) => setEstructurados({ ...estructurados, estadoAvanceId: e.target.value })}>
                <option value="">Sin indicar</option>
                {(estados.data ?? [])
                  .filter((x) => x.activo)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {(intervenciones.data ?? []).some((i) => i.activo) && (
            <ChoiceGroup
              legend="Intervenciones realizadas"
              type="checkbox"
              options={(intervenciones.data ?? []).filter((i) => i.activo).map((i) => ({ value: i.id, label: i.nombre }))}
              value={estructurados.intervencionIds}
              onChange={(v) => setEstructurados({ ...estructurados, intervencionIds: v.slice(0, 20) })}
            />
          )}
          {registrar.error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {registrar.error instanceof ApiError ? registrar.error.message : 'No pudimos registrar la evolución.'}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        abierto={descartar}
        onCerrar={() => setDescartar(false)}
        titulo="¿Descartar el borrador?"
        descripcion="Se borra lo que escribiste. No queda nada en el expediente."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setDescartar(false)}>
              Volver
            </Button>
            <Button variant="team" icon="delete" loading={quitar.isPending} onClick={() => quitar.mutate()}>
              Descartar
            </Button>
          </>
        }
      >
        {quitar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {quitar.error instanceof ApiError ? quitar.error.message : 'No pudimos descartar el borrador.'}
          </p>
        )}
      </Modal>
    </>
  );
}

function cuerpoBorrador(contenido: string, citaId: string, plantillaId: string, valores: ValoresPlantilla) {
  return { contenido, citaId: citaId || undefined, plantillaId: plantillaId || undefined, valores: plantillaId ? valores : undefined };
}

const TEXTO_GUARDADO: Record<EstadoGuardado, string> = {
  vacio: 'Escribe las notas para guardar el borrador',
  pendiente: 'Cambios sin guardar',
  guardando: 'Guardando…',
  guardado: 'Borrador guardado',
  error: 'No se pudo guardar',
};

function IndicadorGuardado({ estado }: { estado: EstadoGuardado }) {
  return (
    <span role="status" aria-live="polite" className={`text-[12.5px] font-bold ${estado === 'error' ? 'text-accent-700' : 'text-neutral-700'}`}>
      {TEXTO_GUARDADO[estado]}
    </span>
  );
}
