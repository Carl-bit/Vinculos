/**
 * Extension de Prisma que cifra al escribir y descifra al leer SOLO los campos
 * de CAMPOS_CIFRADOS (registro.ts), con AAD = tabla:columna:id_fila
 * (docs/seguridad/cifrado.md). Ningun otro lugar cifra campos del registro
 * en operaciones de modelo; las funciones SQL ($queryRaw) se descifran con
 * LlaveroService.descifrarCampo.
 *
 * Reglas:
 * - Escritura: el valor debe venir como claro('...'); el id de la fila (parte
 *   del AAD) debe estar en data (create) o en where (update/upsert). Las
 *   filas con columnas cifradas no tienen DEFAULT de id: la API lo genera
 *   (randomUUID) antes del create.
 * - updateMany con campos cifrados se rechaza (no hay un id por fila).
 * - Lectura: si un select pide un campo cifrado sin el id, se agrega el id.
 *   Se descifra tambien dentro de include/select de relaciones.
 * - Escrituras anidadas (create dentro de create) con campos cifrados no se
 *   soportan: crear cada fila por separado.
 */
import { Prisma } from '@prisma/client';

import { aad, ErrorCifrado, type Llavero } from '../../common/crypto/cifrado';
import { CAMPOS_CIFRADOS, type CampoCifrado } from '../../common/crypto/registro';
import { esClaro, valorClaro } from './claro';

interface InfoModelo {
  campos: CampoCifrado[];
  /** Campo Prisma usado como id en el AAD (id o usuarioId). */
  idCampo: string;
}

type Datos = Record<string, unknown>;

const aCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

const CIFRADOS = new Map<string, InfoModelo>();
for (const c of CAMPOS_CIFRADOS) {
  const info = CIFRADOS.get(c.modelo) ?? { campos: [], idCampo: aCamel(c.id) };
  info.campos.push(c);
  CIFRADOS.set(c.modelo, info);
}

/** Relaciones de cada modelo (campo -> modelo), para descifrar includes. */
const RELACIONES = new Map<string, [string, string][]>(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    m.fields.filter((f) => f.kind === 'object').map((f): [string, string] => [f.name, f.type]),
  ]),
);

function cifrarDatos(llavero: Llavero, modelo: string, info: InfoModelo, data: Datos | undefined, id: unknown): void {
  if (!data) {
    return;
  }
  for (const c of info.campos) {
    let valor = data[c.campo];
    if (valor && typeof valor === 'object' && !(valor instanceof Uint8Array) && !esClaro(valor) && 'set' in valor) {
      valor = (valor as { set: unknown }).set;
    }
    if (valor === undefined || valor === null) {
      continue;
    }
    if (!esClaro(valor)) {
      throw new ErrorCifrado(`${modelo}.${c.campo}: escribir con claro(); los campos cifrados no se escriben a mano`);
    }
    if (typeof id !== 'string' || id === '') {
      throw new ErrorCifrado(`${modelo}.${c.campo}: falta el id de la fila para el AAD`);
    }
    data[c.campo] = llavero.cifrar(valorClaro(valor), c.categoria, aad(c.tabla, c.columna, id));
  }
}

function tieneCifrados(info: InfoModelo, data: Datos | undefined): boolean {
  return !!data && info.campos.some((c) => data[c.campo] !== undefined);
}

function asegurarIdEnSelect(info: InfoModelo, args: Datos): void {
  const select = args.select as Datos | undefined;
  if (select && info.campos.some((c) => select[c.campo]) && !select[info.idCampo]) {
    args.select = { ...select, [info.idCampo]: true };
  }
}

function descifrar(llavero: Llavero, modelo: string, valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map((v) => descifrar(llavero, modelo, v));
  }
  if (!valor || typeof valor !== 'object' || valor instanceof Date || valor instanceof Uint8Array) {
    return valor;
  }
  const fila = valor as Datos;
  const info = CIFRADOS.get(modelo);
  if (info) {
    for (const c of info.campos) {
      const v = fila[c.campo];
      if (!(v instanceof Uint8Array)) {
        continue;
      }
      const id = fila[info.idCampo];
      if (typeof id !== 'string') {
        throw new ErrorCifrado(`${modelo}.${c.campo}: lectura sin el id de la fila (AAD)`);
      }
      fila[c.campo] = llavero.descifrar(Buffer.from(v.buffer, v.byteOffset, v.byteLength), aad(c.tabla, c.columna, id));
    }
  }
  for (const [campo, relacionado] of RELACIONES.get(modelo) ?? []) {
    if (fila[campo] !== undefined && fila[campo] !== null) {
      fila[campo] = descifrar(llavero, relacionado, fila[campo]);
    }
  }
  return fila;
}

export function extensionCifrado(llavero: () => Llavero) {
  return Prisma.defineExtension({
    name: 'cifrado',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const info = CIFRADOS.get(model);
          const a = args as Datos;
          if (info) {
            const l = llavero();
            switch (operation) {
              case 'create': {
                const data = a.data as Datos;
                cifrarDatos(l, model, info, data, data[info.idCampo]);
                break;
              }
              case 'createMany':
              case 'createManyAndReturn': {
                const filas = (Array.isArray(a.data) ? a.data : [a.data]) as Datos[];
                filas.forEach((d) => cifrarDatos(l, model, info, d, d[info.idCampo]));
                break;
              }
              case 'update': {
                const id = (a.where as Datos)[info.idCampo];
                cifrarDatos(l, model, info, a.data as Datos, id);
                break;
              }
              case 'upsert': {
                const id = (a.where as Datos)[info.idCampo];
                cifrarDatos(l, model, info, a.create as Datos, (a.create as Datos)[info.idCampo] ?? id);
                cifrarDatos(l, model, info, a.update as Datos, id);
                break;
              }
              case 'updateMany':
              case 'updateManyAndReturn':
                if (tieneCifrados(info, a.data as Datos)) {
                  throw new ErrorCifrado(`${model}: updateMany no admite campos cifrados (usar update por id)`);
                }
                break;
            }
            asegurarIdEnSelect(info, a);
          }
          const resultado = await query(args);
          return descifrar(llavero(), model, resultado);
        },
      },
    },
  });
}
