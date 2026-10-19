'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { FormularioDinamico, faltantes, type ValoresPlantilla as Valores } from '@/components/shared/FormularioDinamico';
import { ValoresPlantilla } from '@/components/shared/ValoresPlantilla';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { correccionesDe, useIngresos, usePlantillasAplicables, type IngresoVista } from '@/lib/fichas';
import { formatoFechaHora, formatoFechaLarga } from '@/lib/formato';

/**
 * Ficha de ingreso / anamnesis (append-only). Cada tratante escribe la suya
 * con una plantilla INGRESO de su especialidad; un error se corrige con un
 * registro nuevo en la misma version de plantilla. Lo anterior se conserva.
 */
export function IngresoFicha({ fichaId, miId }: { fichaId: string; miId: string | undefined }) {
  const ingresos = useIngresos(fichaId);
  const [editor, setEditor] = useState<{ corrige?: IngresoVista } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {editor ? (
        <EditorIngreso fichaId={fichaId} corrige={editor.corrige} onListo={() => setEditor(null)} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-[560px] text-[13.5px] font-semibold text-neutral-800">
            Motivo de consulta, antecedentes y lo que pida la plantilla de tu especialidad. Cada registro queda con la versión de plantilla con que se escribió.
          </p>
          <Button variant="team" icon="add" onClick={() => setEditor({})}>
            Registrar ingreso
          </Button>
        </div>
      )}
      <EstadoConsulta consulta={ingresos} vacio={(l) => l.length === 0} textoVacio="Todavía no hay ficha de ingreso">
        {(lista) => {
          const corregidos = correccionesDe(lista);
          const porId = new Map(lista.map((i) => [i.id, i]));
          return (
            <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
              {[...lista]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((i) => {
                  const correccion = corregidos.get(i.id);
                  const original = i.corrigeAId ? porId.get(i.corrigeAId) : undefined;
                  return (
                    <li key={i.id} id={`ingreso-${i.id}`} className="scroll-mt-24">
                      <Panel
                        nivel={2}
                        titulo={`${i.plantilla.nombre} · versión ${i.plantilla.version}`}
                        bajada={`Registrado el ${formatoFechaHora(i.createdAt)}`}
                        accion={
                          <div className="flex flex-wrap gap-1.5">
                            {i.corrigeAId && <Badge tono="atencion">Corrección</Badge>}
                            {correccion && <Badge tono="neutro">Corregido</Badge>}
                          </div>
                        }
                        className={correccion ? '!border-dashed' : ''}
                      >
                        <ValoresPlantilla campos={i.plantilla.definicion} valores={i.valores as Valores} />
                        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-3">
                          <div className="flex flex-col gap-1 text-[12.5px]">
                            {original && (
                              <a href={`#ingreso-${original.id}`} className="flex items-center gap-1.5 font-extrabold text-accent-700 hover:text-accent-800">
                                <Icon name="history" size={16} />
                                Corrige el registro del {formatoFechaLarga(original.createdAt)}
                              </a>
                            )}
                            {correccion && (
                              <a href={`#ingreso-${correccion.id}`} className="flex items-center gap-1.5 font-extrabold text-accent-700 hover:text-accent-800">
                                <Icon name="history" size={16} />
                                Ver la corrección del {formatoFechaLarga(correccion.createdAt)}
                              </a>
                            )}
                          </div>
                          {i.autorId === miId && !correccion && !editor && (
                            <Button variant="ghost" icon="edit_note" onClick={() => setEditor({ corrige: i })} className="!px-3.5 !py-2 !text-[13px]">
                              Corregir
                            </Button>
                          )}
                        </div>
                      </Panel>
                    </li>
                  );
                })}
            </ol>
          );
        }}
      </EstadoConsulta>
    </div>
  );
}

function EditorIngreso({ fichaId, corrige, onListo }: { fichaId: string; corrige?: IngresoVista; onListo: () => void }) {
  const cliente = useQueryClient();
  const plantillas = usePlantillasAplicables('INGRESO');
  const [plantillaId, setPlantillaId] = useState(corrige?.plantilla.id ?? '');
  const [valores, setValores] = useState<Valores>((corrige?.valores ?? {}) as Valores);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState(false);
  const plantilla = corrige?.plantilla ?? plantillas.lista.find((p) => p.id === plantillaId);
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/fichas/{fichaId}/ingresos', {
          params: { path: { fichaId } },
          body: { plantillaId: plantilla!.id, valores, corrigeAId: corrige?.id },
        }),
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['ficha', fichaId, 'ingresos'] });
      onListo();
    },
  });
  const revisar = () => {
    if (!plantilla) return setErrores({ plantilla: 'Elige la plantilla de ingreso.' });
    const f = faltantes(plantilla.definicion, valores);
    setErrores(f);
    if (Object.keys(f).length === 0) setConfirmar(true);
  };
  return (
    <>
      <Panel
        variante="equipo"
        titulo={corrige ? 'Corregir ficha de ingreso' : 'Registrar ficha de ingreso'}
        bajada={
          corrige
            ? `Corriges el registro del ${formatoFechaLarga(corrige.createdAt)} con la misma versión de plantilla. El original se conserva.`
            : 'Queda en el expediente al guardarlo: después solo se corrige con un registro nuevo.'
        }
      >
        <div className="flex flex-col gap-4">
          {!corrige &&
            (plantillas.consulta.isPending ? (
              <span aria-hidden="true" className="esqueleto block h-12 rounded-full" />
            ) : plantillas.lista.length === 0 ? (
              <Aviso tono="advertencia" icono="description" titulo="No hay plantilla de ingreso publicada para tu especialidad">
                Propón una en Fichas › Plantillas clínicas; administración la publica.
              </Aviso>
            ) : (
              <Field label="Plantilla de ingreso" required error={errores.plantilla}>
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
                    <option value="">Elige una plantilla</option>
                    {plantillas.lista.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.nombre} · versión {pl.version}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          {plantilla && <FormularioDinamico campos={plantilla.definicion} valores={valores} onChange={setValores} errores={errores} />}
          <div className="flex flex-wrap justify-end gap-2.5 border-t border-divider pt-4">
            <Button variant="ghost" onClick={onListo}>
              Cancelar
            </Button>
            <Button variant="team" icon="task_alt" disabled={!plantilla} onClick={revisar}>
              {corrige ? 'Registrar corrección' : 'Guardar en el expediente'}
            </Button>
          </div>
        </div>
      </Panel>
      <Modal
        abierto={confirmar}
        onCerrar={() => setConfirmar(false)}
        titulo={corrige ? 'Registrar corrección' : 'Guardar ficha de ingreso'}
        descripcion="El registro queda en el expediente y no se edita ni se borra. Un error se corrige con un registro nuevo."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmar(false)}>
              Volver a editar
            </Button>
            <Button variant="team" icon="task_alt" loading={guardar.isPending} onClick={() => guardar.mutate()}>
              Guardar
            </Button>
          </>
        }
      >
        {guardar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar la ficha de ingreso.'}
          </p>
        )}
      </Modal>
    </>
  );
}
