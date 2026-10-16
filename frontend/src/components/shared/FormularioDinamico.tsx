'use client';

import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import type { components } from '@/lib/api/esquema';

export type CampoPlantilla = components['schemas']['CampoPlantillaDto'];
/** Valores de una plantilla clinica: { clave: valor } (la API los valida contra la version). */
export type ValoresPlantilla = Record<string, string | number | boolean | string[]>;

/** Mismo texto que backend/src/common/plantillas-clinicas.ts (ADVERTENCIA_TEXTO_LIBRE). */
export const ADVERTENCIA_TEXTO_LIBRE =
  'No escriba datos identificatorios (nombres, RUT, telefonos, direcciones) en el texto libre: ' +
  'queda cifrado en reposo, pero lo lee cualquiera con acceso a esta evolucion (incluida la supervision).';

const LARGO = { TEXTO: 500, TEXTO_LARGO: 10_000 } as const;
const SI_NO = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
] as const;

const vacio = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Obligatorios sin valor ({ clave: mensaje }). Formato y opciones los valida la API (422). */
export function faltantes(campos: readonly CampoPlantilla[], valores: ValoresPlantilla): Record<string, string> {
  return Object.fromEntries(campos.filter((c) => c.obligatorio && vacio(valores[c.clave])).map((c) => [c.clave, 'Este campo es obligatorio.']));
}

interface FormularioDinamicoProps {
  campos: readonly CampoPlantilla[];
  valores: ValoresPlantilla;
  onChange: (valores: ValoresPlantilla) => void;
  errores?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Renderiza los campos de una version de plantilla clinica (ingreso o
 * evolucion). Controlado: el padre guarda los valores y los envia. Un campo
 * vaciado se quita del objeto (la API trata ausente = sin valor).
 */
export function FormularioDinamico({ campos, valores, onChange, errores = {}, disabled }: FormularioDinamicoProps) {
  const fijar = (clave: string, valor: ValoresPlantilla[string] | undefined) => {
    const { [clave]: _anterior, ...resto } = valores;
    onChange(vacio(valor) ? resto : { ...resto, [clave]: valor! });
  };

  return (
    <div className="flex flex-col gap-4">
      {[...campos]
        .sort((a, b) => a.orden - b.orden)
        .map((c) => {
          const valor = valores[c.clave];
          const error = errores[c.clave];
          const ayuda = c.es_texto_libre ? ADVERTENCIA_TEXTO_LIBRE : undefined;

          if (c.tipo === 'SELECCION_MULTIPLE' || c.tipo === 'SI_NO') {
            const multiple = c.tipo === 'SELECCION_MULTIPLE';
            const opciones = multiple ? (c.opciones ?? []).map((o) => ({ value: o, label: o })) : SI_NO;
            const marcados = multiple ? ((valor as string[] | undefined) ?? []) : valor === undefined ? [] : [valor ? 'si' : 'no'];
            return (
              <ChoiceGroup
                key={c.clave}
                legend={c.etiqueta}
                type={multiple ? 'checkbox' : 'radio'}
                options={opciones}
                value={marcados}
                required={c.obligatorio}
                error={error}
                disabled={disabled}
                onChange={(v) => fijar(c.clave, multiple ? v : v[0] === 'si')}
              />
            );
          }

          return (
            <Field key={c.clave} label={c.etiqueta} required={c.obligatorio} error={error} hint={ayuda}>
              {(p) => {
                const comun = { ...p, name: c.clave, disabled };
                switch (c.tipo) {
                  case 'TEXTO_LARGO':
                    return (
                      <Textarea {...comun} maxLength={LARGO.TEXTO_LARGO} value={(valor as string) ?? ''} onChange={(e) => fijar(c.clave, e.target.value)} />
                    );
                  case 'NUMERO':
                    return (
                      <Input
                        {...comun}
                        type="number"
                        inputMode="decimal"
                        value={valor === undefined ? '' : String(valor)}
                        onChange={(e) => fijar(c.clave, e.target.value === '' ? undefined : e.target.valueAsNumber)}
                      />
                    );
                  case 'FECHA':
                    return <Input {...comun} type="date" value={(valor as string) ?? ''} onChange={(e) => fijar(c.clave, e.target.value)} />;
                  case 'SELECCION_UNICA':
                    return (
                      <Select {...comun} value={(valor as string) ?? ''} onChange={(e) => fijar(c.clave, e.target.value)}>
                        <option value="">Elige una opción</option>
                        {(c.opciones ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                    );
                  default:
                    return (
                      <Input {...comun} type="text" maxLength={LARGO.TEXTO} value={(valor as string) ?? ''} onChange={(e) => fijar(c.clave, e.target.value)} />
                    );
                }
              }}
            </Field>
          );
        })}
    </div>
  );
}
