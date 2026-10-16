/**
 * Plantillas clinicas por especialidad (03a-2). La BD valida la forma de la
 * definicion (definicion_plantilla_valida); los valores van cifrados como un
 * solo JSON, asi que su validacion contra la version de la plantilla ocurre
 * aqui, antes de cifrar.
 */

/** La UI la muestra junto al texto libre y en la respuesta de creacion (cifrado.md). */
export const ADVERTENCIA_TEXTO_LIBRE =
  'No escriba datos identificatorios (nombres, RUT, telefonos, direcciones) en el texto libre: ' +
  'queda cifrado en reposo, pero lo lee cualquiera con acceso a esta evolucion (incluida la supervision).';

export type TipoCampo = 'TEXTO' | 'TEXTO_LARGO' | 'NUMERO' | 'FECHA' | 'SELECCION_UNICA' | 'SELECCION_MULTIPLE' | 'SI_NO';

export interface CampoPlantilla {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  obligatorio: boolean;
  opciones?: string[];
  orden: number;
  visible_en_supervision: boolean;
  es_texto_libre: boolean;
}

export type ValoresPlantilla = Record<string, string | number | boolean | string[]>;

const LARGO: Record<'TEXTO' | 'TEXTO_LARGO', number> = { TEXTO: 500, TEXTO_LARGO: 10_000 };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const vacio = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Errores de los valores contra la definicion (lista vacia = validos).
 * Claves desconocidas, tipos, opciones y largo siempre; obligatorios solo si
 * `exigirObligatorios` (un borrador puede quedar incompleto).
 */
export function erroresValores(definicion: CampoPlantilla[], valores: unknown, exigirObligatorios = true): string[] {
  if (typeof valores !== 'object' || valores === null || Array.isArray(valores)) {
    return ['valores debe ser un objeto { clave: valor }'];
  }
  const v = valores as Record<string, unknown>;
  const campos = new Map(definicion.map((c) => [c.clave, c]));
  const errores = Object.keys(v)
    .filter((k) => !campos.has(k))
    .map((k) => `${k}: campo inexistente en esta version de la plantilla`);
  for (const c of definicion) {
    const valor = v[c.clave];
    if (vacio(valor)) {
      if (exigirObligatorios && c.obligatorio) errores.push(`${c.clave}: obligatorio`);
      continue;
    }
    const error = errorCampo(c, valor);
    if (error) errores.push(`${c.clave}: ${error}`);
  }
  return errores;
}

function errorCampo(c: CampoPlantilla, valor: unknown): string | null {
  switch (c.tipo) {
    case 'TEXTO':
    case 'TEXTO_LARGO':
      return typeof valor === 'string' && valor.length <= LARGO[c.tipo] ? null : `texto de hasta ${LARGO[c.tipo]} caracteres`;
    case 'NUMERO':
      return typeof valor === 'number' && Number.isFinite(valor) ? null : 'numero';
    case 'FECHA':
      return typeof valor === 'string' && FECHA.test(valor) && !Number.isNaN(Date.parse(valor)) ? null : 'fecha AAAA-MM-DD';
    case 'SI_NO':
      return typeof valor === 'boolean' ? null : 'si/no (true o false)';
    case 'SELECCION_UNICA':
      return typeof valor === 'string' && c.opciones!.includes(valor) ? null : 'una de las opciones de la plantilla';
    case 'SELECCION_MULTIPLE':
      return Array.isArray(valor) && valor.every((x) => typeof x === 'string' && c.opciones!.includes(x)) && new Set(valor).size === valor.length
        ? null
        : 'opciones de la plantilla, sin repetir';
  }
}

/** Solo los campos visibles en supervision (supervision seudonimizada) y cuales son texto libre. */
export function valoresSupervision(definicion: CampoPlantilla[], valores: ValoresPlantilla) {
  const visibles = definicion.filter((c) => c.visible_en_supervision);
  return {
    valores: Object.fromEntries(visibles.filter((c) => c.clave in valores).map((c) => [c.clave, valores[c.clave]])),
    camposTextoLibre: visibles.filter((c) => c.es_texto_libre).map((c) => c.clave),
  };
}
