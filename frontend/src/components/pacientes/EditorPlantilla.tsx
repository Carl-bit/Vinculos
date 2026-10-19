'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { FormularioDinamico, type CampoPlantilla, type ValoresPlantilla } from '@/components/shared/FormularioDinamico';
import { Button } from '@/components/ui/Button';
import { Casilla } from '@/components/ui/Casilla';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { TIPO_PLANTILLA, type PlantillaClinica, type TipoPlantilla } from '@/lib/fichas';

type TipoCampo = CampoPlantilla['tipo'];

const TIPOS_CAMPO: Record<TipoCampo, string> = {
  TEXTO: 'Texto corto',
  TEXTO_LARGO: 'Texto largo',
  NUMERO: 'Número',
  FECHA: 'Fecha',
  SELECCION_UNICA: 'Una opción',
  SELECCION_MULTIPLE: 'Varias opciones',
  SI_NO: 'Sí / No',
};

const CON_OPCIONES: readonly TipoCampo[] = ['SELECCION_UNICA', 'SELECCION_MULTIPLE'];
const MAX_CAMPOS = 60;
const CLAVE = /^[a-z][a-z0-9_]{0,39}$/;

/** Campo en edicion: las opciones se escriben una por linea. */
interface Borrador extends Omit<CampoPlantilla, 'opciones'> {
  opciones: string;
  /** La clave se deriva de la etiqueta hasta que se edita a mano. */
  claveManual: boolean;
}

/** "Motivo de consulta" -> "motivo_de_consulta" (minusculas, sin tildes, hasta 40). */
export function claveDesde(etiqueta: string): string {
  const base = etiqueta
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (/^[a-z]/.test(base) ? base : `campo_${base}`).slice(0, 40).replace(/_+$/, '') || 'campo';
}

const aBorrador = (c: CampoPlantilla): Borrador => ({ ...c, opciones: (c.opciones ?? []).join('\n'), claveManual: true });

const nuevoCampo = (orden: number): Borrador => ({
  clave: '',
  etiqueta: '',
  tipo: 'TEXTO_LARGO',
  obligatorio: false,
  opciones: '',
  orden,
  visible_en_supervision: false,
  es_texto_libre: true,
  claveManual: false,
});

function definicion(campos: readonly Borrador[]): CampoPlantilla[] {
  return campos.map(({ claveManual: _m, opciones, ...c }, i) => ({
    ...c,
    orden: i + 1,
    opciones: CON_OPCIONES.includes(c.tipo)
      ? opciones
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined,
  }));
}

function errores(nombre: string, campos: readonly Borrador[]): string[] {
  const lista: string[] = [];
  if (nombre.trim().length < 2) lista.push('Escribe el nombre de la plantilla.');
  if (!campos.length) lista.push('Agrega al menos un campo.');
  const vistas = new Set<string>();
  campos.forEach((c, i) => {
    const n = `Campo ${i + 1}`;
    if (!c.etiqueta.trim()) lista.push(`${n}: falta la etiqueta.`);
    if (!CLAVE.test(c.clave)) lista.push(`${n}: la clave interna usa minúsculas, dígitos y _ (empieza con letra).`);
    if (vistas.has(c.clave)) lista.push(`${n}: la clave "${c.clave}" ya se usa en otro campo.`);
    vistas.add(c.clave);
    if (CON_OPCIONES.includes(c.tipo)) {
      const ops = c.opciones
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
      if (!ops.length) lista.push(`${n}: escribe al menos una opción.`);
      if (new Set(ops).size !== ops.length) lista.push(`${n}: hay opciones repetidas.`);
    }
  });
  return lista;
}

interface EditorPlantillaProps {
  /** Version en borrador a editar; sin ella, propuesta nueva. */
  plantilla?: PlantillaClinica;
  especialidades: readonly { id: string; nombre: string }[];
  onListo: () => void;
}

/**
 * Editor de plantilla clinica: campos, tipo, opciones, orden, obligatorio,
 * visible en supervision y texto libre, con vista previa del formulario tal
 * como lo vera el tratante. Solo se edita una version en borrador; publicar
 * (ADMIN) la deja inmutable.
 */
export function EditorPlantilla({ plantilla, especialidades, onListo }: EditorPlantillaProps) {
  const cliente = useQueryClient();
  const [nombre, setNombre] = useState(plantilla?.nombre ?? '');
  const [especialidadId, setEspecialidad] = useState(plantilla?.especialidadId ?? especialidades[0]?.id ?? '');
  const [tipo, setTipo] = useState<TipoPlantilla>(plantilla?.tipo ?? 'EVOLUCION');
  const [campos, setCampos] = useState<Borrador[]>(plantilla ? plantilla.definicion.map(aBorrador) : [nuevoCampo(1)]);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [previa, setPrevia] = useState(false);
  const [valoresPrevia, setValoresPrevia] = useState<ValoresPlantilla>({});

  const cambiar = (i: number, cambio: Partial<Borrador>) =>
    setCampos((lista) =>
      lista.map((c, j) => {
        if (j !== i) return c;
        const nuevo = { ...c, ...cambio };
        if ('etiqueta' in cambio && !c.claveManual) nuevo.clave = claveDesde(cambio.etiqueta ?? '');
        if ('tipo' in cambio) nuevo.es_texto_libre = cambio.tipo === 'TEXTO' || cambio.tipo === 'TEXTO_LARGO' ? c.es_texto_libre : false;
        return nuevo;
      }),
    );
  const mover = (i: number, d: -1 | 1) =>
    setCampos((lista) => {
      const copia = [...lista];
      [copia[i], copia[i + d]] = [copia[i + d], copia[i]];
      return copia;
    });

  const guardar = useMutation({
    mutationFn: () => {
      const def = definicion(campos);
      return plantilla
        ? datos(api.PATCH('/api/plantillas-clinicas/{id}', { params: { path: { id: plantilla.id } }, body: { nombre: nombre.trim(), definicion: def } }))
        : datos(api.POST('/api/plantillas-clinicas', { body: { especialidadId, tipo, nombre: nombre.trim(), definicion: def } }));
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['plantillas-clinicas'] });
      onListo();
    },
  });
  const enviar = () => {
    const p = errores(nombre, campos);
    setProblemas(p);
    if (!p.length) guardar.mutate();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre de la plantilla" required>
          {(p) => <Input {...p} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Field>
        {plantilla ? (
          <p className="m-0 self-end text-[13px] font-semibold text-neutral-800">
            {TIPO_PLANTILLA[plantilla.tipo]} · {especialidades.find((e) => e.id === plantilla.especialidadId)?.nombre ?? 'Especialidad'} · versión{' '}
            {plantilla.version}
          </p>
        ) : (
          <Field label="Especialidad" required hint="Proponen administración y profesionales con esa especialidad aprobada.">
            {(p) => (
              <Select {...p} value={especialidadId} onChange={(e) => setEspecialidad(e.target.value)}>
                {especialidades.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      {!plantilla && (
        <ChoiceGroup
          legend="Se usa en"
          type="radio"
          value={[tipo]}
          onChange={(v) => setTipo((v[0] as TipoPlantilla) ?? 'EVOLUCION')}
          options={[
            { value: 'EVOLUCION', label: 'Evoluciones (cada sesión)' },
            { value: 'INGRESO', label: 'Ficha de ingreso (anamnesis)' },
          ]}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-[16px] font-black">Campos ({campos.length})</h3>
        <Button variant="ghost" icon={previa ? 'edit' : 'visibility'} onClick={() => setPrevia((v) => !v)} className="!px-3.5 !py-2 !text-[13px]">
          {previa ? 'Volver a editar' : 'Vista previa del formulario'}
        </Button>
      </div>

      {previa ? (
        <div className="rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-5">
          <FormularioDinamico campos={definicion(campos)} valores={valoresPrevia} onChange={setValoresPrevia} />
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {campos.map((c, i) => (
            <li key={i} className="rounded-lg border border-divider bg-neutral-100 px-[clamp(14px,2.4vw,20px)] py-4">
              <fieldset className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0">
                <legend className="sr-only">Campo {i + 1}</legend>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Campo {i + 1}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => mover(i, -1)}
                      aria-label={`Subir el campo ${i + 1}`}
                      className="flex size-10 cursor-pointer items-center justify-center rounded-full text-neutral-700 hover:bg-accent-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon name="arrow_upward" size={18} />
                    </button>
                    <button
                      type="button"
                      disabled={i === campos.length - 1}
                      onClick={() => mover(i, 1)}
                      aria-label={`Bajar el campo ${i + 1}`}
                      className="flex size-10 cursor-pointer items-center justify-center rounded-full text-neutral-700 hover:bg-accent-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon name="arrow_downward" size={18} />
                    </button>
                    <button
                      type="button"
                      disabled={campos.length === 1}
                      onClick={() => setCampos((l) => l.filter((_, j) => j !== i))}
                      aria-label={`Quitar el campo ${i + 1}`}
                      className="flex size-10 cursor-pointer items-center justify-center rounded-full text-accent-700 hover:bg-accent-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-[1.4fr_1fr]">
                  <Field label="Etiqueta" required>
                    {(p) => <Input {...p} maxLength={120} value={c.etiqueta} onChange={(e) => cambiar(i, { etiqueta: e.target.value })} className="!py-2.5" />}
                  </Field>
                  <Field label="Tipo de respuesta">
                    {(p) => (
                      <Select {...p} value={c.tipo} onChange={(e) => cambiar(i, { tipo: e.target.value as TipoCampo })} className="!py-2.5">
                        {(Object.keys(TIPOS_CAMPO) as TipoCampo[]).map((t) => (
                          <option key={t} value={t}>
                            {TIPOS_CAMPO[t]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Field label="Clave interna" hint="Identifica el campo entre versiones. Se genera desde la etiqueta.">
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={40}
                      value={c.clave}
                      onChange={(e) => cambiar(i, { clave: e.target.value.toLowerCase(), claveManual: true })}
                      className="!max-w-[360px] !py-2 font-mono !text-[13.5px]"
                    />
                  )}
                </Field>
                {CON_OPCIONES.includes(c.tipo) && (
                  <Field label="Opciones" required hint="Una por línea.">
                    {(p) => <Textarea {...p} rows={3} value={c.opciones} onChange={(e) => cambiar(i, { opciones: e.target.value })} className="!min-h-20" />}
                  </Field>
                )}
                <div className="flex flex-col gap-2">
                  <Casilla checked={c.obligatorio} onChange={(v) => cambiar(i, { obligatorio: v })}>
                    Obligatorio al confirmar
                  </Casilla>
                  <Casilla checked={c.visible_en_supervision} onChange={(v) => cambiar(i, { visible_en_supervision: v })}>
                    Visible en la supervisión seudonimizada
                  </Casilla>
                  {(c.tipo === 'TEXTO' || c.tipo === 'TEXTO_LARGO') && (
                    <Casilla checked={c.es_texto_libre} onChange={(v) => cambiar(i, { es_texto_libre: v })}>
                      Texto libre (muestra el aviso de no escribir datos identificatorios)
                    </Casilla>
                  )}
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
      )}

      {!previa && (
        <div>
          <Button variant="secondary" icon="add" disabled={campos.length >= MAX_CAMPOS} onClick={() => setCampos((l) => [...l, nuevoCampo(l.length + 1)])}>
            Agregar campo
          </Button>
        </div>
      )}

      {(problemas.length > 0 || guardar.error) && (
        <div role="alert" className="flex flex-col gap-1 text-[13px] font-bold text-accent-700">
          {problemas.map((p) => (
            <p key={p} className="m-0">
              {p}
            </p>
          ))}
          {guardar.error && <p className="m-0">{guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar la plantilla.'}</p>}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2.5 border-t border-divider pt-4">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" icon="save" loading={guardar.isPending} onClick={enviar}>
          {plantilla ? 'Guardar borrador' : 'Guardar propuesta'}
        </Button>
      </div>
    </div>
  );
}
