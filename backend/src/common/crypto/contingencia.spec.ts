import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ErrorCifrado, Llavero, aad, huellaKek } from './cifrado';
import {
  AlmacenLlaves,
  Custodio,
  FilaLlaveCompleta,
  aprovisionar,
  dividirPrivada,
  generarKek,
  generarParRecuperacion,
  nuevaDek,
  reconstruirPrivada,
  recuperar,
  rotarActivar,
  rotarCrear,
  rotarRecuperacion,
  verificar,
} from './contingencia';

jest.setTimeout(120_000);

/** Almacen en memoria con las mismas reglas que la BD (sin DELETE). */
class AlmacenMemoria implements AlmacenLlaves {
  filas: FilaLlaveCompleta[] = [];
  eventos: string[] = [];
  async listar() {
    return this.filas.map((f) => ({ ...f }));
  }
  async insertar(filas: FilaLlaveCompleta[]) {
    this.filas.push(...filas.map((f) => ({ ...f })));
  }
  async activar(ids: string[]) {
    for (const nueva of this.filas.filter((f) => ids.includes(f.id))) {
      for (const vieja of this.filas.filter((f) => f.categoria === nueva.categoria && f.activa)) {
        vieja.activa = false;
        vieja.retiradaEn = new Date();
      }
      nueva.activa = true;
    }
  }
  async reenvolver(cambios: { id: string; dekPorKek: Buffer; huellaKek: string }[]) {
    for (const c of cambios) {
      Object.assign(
        this.filas.find((f) => f.id === c.id)!,
        { dekPorKek: c.dekPorKek, huellaKek: c.huellaKek },
      );
    }
  }
  async reenvolverRecuperacion(cambios: { id: string; dekPorRecuperacion: Buffer }[]) {
    for (const c of cambios) {
      this.filas.find((f) => f.id === c.id)!.dekPorRecuperacion = c.dekPorRecuperacion;
    }
  }
  async evento(tipo: string) {
    this.eventos.push(tipo);
  }
}

const custodios: Custodio[] = [
  { parte: 1, custodio: 'Proveedor', rol: 'operador plataforma' },
  { parte: 2, custodio: 'Centro', rol: 'direccion' },
  { parte: 3, custodio: 'Sobre offline', rol: 'caja fuerte' },
];

describe('contingencia de llaves', () => {
  let dir: string;
  let almacen: AlmacenMemoria;
  let partes: Buffer[];
  let kek: Buffer;
  let publica: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'llaves-'));
    almacen = new AlmacenMemoria();
    await aprovisionar(
      { kekPath: join(dir, 'kek'), publicaPath: join(dir, 'recuperacion.pub'), partesDir: join(dir, 'partes'), custodios, actor: 'test' },
      almacen,
    );
    kek = readFileSync(join(dir, 'kek'));
    publica = readFileSync(join(dir, 'recuperacion.pub'), 'utf8');
    partes = readdirSync(join(dir, 'partes'))
      .sort()
      .map((f) => readFileSync(join(dir, 'partes', f)));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('aprovisiona 4 DEK activas, 3 partes separadas y no deja la privada en disco', async () => {
    expect(almacen.filas).toHaveLength(4);
    expect(partes).toHaveLength(3);
    expect(readdirSync(dir).sort()).toEqual(['kek', 'partes', 'recuperacion.pub']);
    expect(await verificar(almacen.filas, { kek })).toEqual([]);
    expect(almacen.eventos).toEqual(['APROVISIONAMIENTO']);
  });

  it('aprovisionar se niega a sobrescribir llaves existentes', async () => {
    const op = { kekPath: join(dir, 'kek'), publicaPath: join(dir, 'otra.pub'), partesDir: join(dir, 'otras'), custodios, actor: 'test' };
    await expect(aprovisionar(op, new AlmacenMemoria())).rejects.toThrow(/nunca sobrescribe/);
    const otroDir = mkdtempSync(join(tmpdir(), 'llaves-'));
    const op2 = { kekPath: join(otroDir, 'kek'), publicaPath: join(otroDir, 'p.pub'), partesDir: join(otroDir, 'partes'), custodios, actor: 'test' };
    await expect(aprovisionar(op2, almacen)).rejects.toThrow(/nunca sobrescribe/);
    rmSync(otroDir, { recursive: true, force: true });
  });

  it('cualquier par de partes recupera las DEK; una sola parte no', async () => {
    for (const par of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      expect(await verificar(almacen.filas, { partes: par.map((i) => partes[i]) })).toEqual([]);
    }
    await expect(reconstruirPrivada([partes[0]])).rejects.toThrow(ErrorCifrado);
    await expect(verificar(almacen.filas, { partes: [partes[2]] })).rejects.toThrow(ErrorCifrado);
  });

  it('partes de otro silo no reconstruyen esta llave', async () => {
    const ajenas = await dividirPrivada(generarParRecuperacion().privada);
    const fallos = await verificar(almacen.filas, { partes: [ajenas[0], ajenas[1]] });
    expect(fallos).toHaveLength(4);
  });

  it('rotacion en dos fases: no destruye versiones y los datos viejos siguen legibles', async () => {
    const llaveroV1 = Llavero.cargar(kek, almacen.filas);
    const idFila = randomUUID();
    const viejo = llaveroV1.cifrar('nota antigua', 'CLINICO', aad('evoluciones', 'notas', idFila));

    await rotarCrear(kek, publica, ['CLINICO'], almacen, 'test');
    await expect(rotarCrear(kek, publica, ['CLINICO'], almacen, 'test')).rejects.toThrow(/rotacion pendiente/);
    expect(almacen.filas).toHaveLength(5);
    await rotarActivar(kek, almacen, 'test');

    const clinicas = almacen.filas.filter((f) => f.categoria === 'CLINICO');
    expect(clinicas.map((f) => [f.version, f.activa, f.retiradaEn !== null])).toEqual([
      [1, false, true],
      [2, true, false],
    ]);
    const llaveroV2 = Llavero.cargar(kek, almacen.filas);
    expect(llaveroV2.descifrar(viejo, aad('evoluciones', 'notas', idFila))).toBe('nota antigua');
  });

  it('una version nueva que no verifica no se activa', async () => {
    const mala = { ...nuevaDek('FINANCIERO', 99, false, kek, publica) };
    mala.canario = Buffer.from(mala.canario);
    mala.canario[mala.canario.length - 1] ^= 0x01;
    const otro = new AlmacenMemoria();
    otro.filas = [...(await almacen.listar()), mala];
    await expect(rotarActivar(kek, otro, 'test')).rejects.toThrow(/no verifica/);
    expect(otro.filas.find((f) => f.id === mala.id)!.activa).toBe(false);
  });

  it('KEK perdida: 2 partes re-envuelven todo con una KEK nueva; la vieja deja de servir', async () => {
    const kekNueva = generarKek();
    await recuperar([partes[2], partes[0]], kekNueva, almacen, 'test');
    expect(almacen.filas.every((f) => f.huellaKek === huellaKek(kekNueva))).toBe(true);
    expect(() => Llavero.cargar(kekNueva, almacen.filas)).not.toThrow();
    expect(() => Llavero.cargar(kek, almacen.filas)).toThrow(/KEK montada no corresponde/);
    expect(almacen.eventos).toContain('RESTAURACION');
  });

  it('cambio de custodios: las partes nuevas recuperan y las anteriores ya no', async () => {
    const filas = await almacen.listar();
    const kekActual = generarKek();
    const otro = new AlmacenMemoria();
    // Mismo estado, re-envuelto con una KEK conocida para el test.
    await recuperar([partes[0], partes[1]], kekActual, Object.assign(otro, { filas }), 'test');
    await rotarRecuperacion(kekActual, { publicaPath: join(dir, 'nueva.pub'), partesDir: join(dir, 'partes_nuevas'), custodios, actor: 'test' }, otro);
    const nuevas = readdirSync(join(dir, 'partes_nuevas'))
      .sort()
      .map((f) => readFileSync(join(dir, 'partes_nuevas', f)));
    expect(await verificar(otro.filas, { partes: [nuevas[0], nuevas[2]] })).toEqual([]);
    expect(await verificar(otro.filas, { partes: [partes[0], partes[1]] })).toHaveLength(otro.filas.length);
    expect(otro.eventos).toContain('CAMBIO_CUSTODIO');
  });

  it('un canario alterado se detecta en la verificacion', async () => {
    const filas = await almacen.listar();
    filas[0].canario = Buffer.from(filas[0].canario);
    filas[0].canario[filas[0].canario.length - 1] ^= 0x01;
    expect((await verificar(filas, { partes: [partes[0], partes[1]] })).join()).toMatch(/canario invalido/);
  });
});
