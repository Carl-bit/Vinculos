import { randomUUID } from 'node:crypto';
import {
  CATEGORIAS,
  ErrorCifrado,
  FilaLlave,
  LARGO_MINIMO,
  Llavero,
  aad,
  crearCanario,
  envolverConKek,
  huellaKek,
  normalizarRut,
} from './cifrado';
import { generarKek } from './contingencia';
import { CAMPOS_CIFRADOS } from './registro';

function filaDePrueba(kek: Buffer, categoria: FilaLlave['categoria'], version: number, activa: boolean): FilaLlave {
  const id = randomUUID();
  const dek = generarKek();
  return {
    id,
    categoria,
    version,
    activa,
    dekPorKek: envolverConKek(kek, dek, id),
    huellaKek: huellaKek(kek),
    canario: crearCanario(categoria, dek, id, version),
  };
}

function llaveroDePrueba(kek = generarKek()): { kek: Buffer; filas: FilaLlave[]; llavero: Llavero } {
  const filas = CATEGORIAS.map((c) => filaDePrueba(kek, c, 1, true));
  return { kek, filas, llavero: Llavero.cargar(kek, filas) };
}

describe('cifrado de aplicacion', () => {
  const idFila = randomUUID();
  const aadNotas = aad('evoluciones', 'notas', idFila);

  it('ida y vuelta, con formato de largo minimo', () => {
    const { llavero } = llaveroDePrueba();
    const datos = llavero.cifrar('Paciente refiere mejoria', 'CLINICO', aadNotas);
    expect(llavero.descifrar(datos, aadNotas)).toBe('Paciente refiere mejoria');
    expect(llavero.cifrar('', 'CLINICO', aadNotas).length).toBe(LARGO_MINIMO);
    // El texto claro no aparece en los bytes guardados.
    expect(datos.includes(Buffer.from('mejoria'))).toBe(false);
  });

  it('detecta manipulacion del cifrado o de la cabecera', () => {
    const { llavero } = llaveroDePrueba();
    const datos = llavero.cifrar('dato', 'CLINICO', aadNotas);
    const alterado = Buffer.from(datos);
    alterado[alterado.length - 20] ^= 0x01;
    expect(() => llavero.descifrar(alterado, aadNotas)).toThrow(ErrorCifrado);
    const otraVersion = Buffer.from(datos);
    otraVersion[20] ^= 0x01;
    expect(() => llavero.descifrar(otraVersion, aadNotas)).toThrow(ErrorCifrado);
  });

  it('un valor copiado a otra fila (AAD distinto) no descifra', () => {
    const { llavero } = llaveroDePrueba();
    const datos = llavero.cifrar('dato', 'CLINICO', aadNotas);
    expect(() => llavero.descifrar(datos, aad('evoluciones', 'notas', randomUUID()))).toThrow(ErrorCifrado);
    expect(() => llavero.descifrar(datos, aad('evoluciones', 'autor_nombre', idFila))).toThrow(ErrorCifrado);
  });

  it('tras rotar, cifra con la version nueva y sigue leyendo la anterior', () => {
    const { kek, filas, llavero: antes } = llaveroDePrueba();
    const viejo = antes.cifrar('dato v1', 'CLINICO', aadNotas);
    const clinicoV1 = filas.find((f) => f.categoria === 'CLINICO')!;
    const clinicoV2 = filaDePrueba(kek, 'CLINICO', 2, true);
    const despues = Llavero.cargar(kek, [...filas.filter((f) => f !== clinicoV1), { ...clinicoV1, activa: false }, clinicoV2]);
    expect(despues.descifrar(viejo, aadNotas)).toBe('dato v1');
    const nuevo = despues.cifrar('dato v2', 'CLINICO', aadNotas);
    expect(nuevo.readUInt32BE(17)).toBe(2);
    expect(despues.descifrar(nuevo, aadNotas)).toBe('dato v2');
  });

  it('normaliza el RUT antes del HMAC (mismo indice ciego para cualquier escritura)', () => {
    expect(normalizarRut('12.345.678-k')).toBe('12345678K');
    expect(normalizarRut(' 9876543-2 ')).toBe('98765432');
    expect(() => normalizarRut('12.345-ABC')).toThrow(ErrorCifrado);
    const { llavero } = llaveroDePrueba();
    expect(llavero.hmacRut('12.345.678-k').equals(llavero.hmacRut('12345678K'))).toBe(true);
    expect(llavero.hmacRut('12345678K').length).toBe(32);
  });

  it('la API no arranca con KEK de otra huella ni con canario alterado', () => {
    const { filas } = llaveroDePrueba();
    expect(() => Llavero.cargar(generarKek(), filas)).toThrow(/KEK montada no corresponde/);
    const kek = generarKek();
    const sanas = CATEGORIAS.map((c) => filaDePrueba(kek, c, 1, true));
    const canario = Buffer.from(sanas[1].canario);
    canario[canario.length - 1] ^= 0x01;
    expect(() => Llavero.cargar(kek, [sanas[0], { ...sanas[1], canario }, sanas[2], sanas[3]])).toThrow(/Canario invalido/);
    expect(() => Llavero.cargar(kek, sanas.slice(0, 3))).toThrow(/Sin DEK activa/);
  });

  it('el registro de campos cifrados no repite columnas y no incluye HMAC', () => {
    const claves = CAMPOS_CIFRADOS.map((c) => `${c.tabla}.${c.columna}`);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves.some((c) => c.endsWith('_hmac'))).toBe(false);
  });
});
