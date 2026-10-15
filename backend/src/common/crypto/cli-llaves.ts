/**
 * CLI de operacion de llaves. Lo invocan los scripts de infra/scripts/llaves/
 * (nunca la API). Conecta como dueño (MIGRATION_DATABASE_URL): llaves_datos,
 * custodios_llave y eventos_llaves no tienen GRANT para app_user.
 *
 *   aprovisionar  --kek F --publica F --partes DIR --custodios "nombre:rol,nombre:rol,nombre:rol" --actor A
 *   rotar-crear   --kek F --publica F --categorias IDENTIFICACION,CLINICO,FINANCIERO --actor A
 *                 (HMAC solo con --compromiso-hmac si: runbook de compromiso)
 *   rotar-activar --kek F --actor A
 *   rotar-kek     --kek F --kek-nueva F --actor A
 *   recuperar     --parte F --parte F --kek-nueva F --actor A
 *   verificar     (--kek F | --parte F --parte F) [--actor A --registrar SIMULACRO|VERIFICACION]
 *   cambiar-custodios --kek F --publica F --partes DIR --custodios "..." --actor A
 *   registrar     --tipo SIMULACRO|COMPROMISO|... --detalle TEXTO --actor A
 *   recalcular-hmac --kek F [--lote N] --actor A   (runbook de compromiso: con la HMAC nueva aun pendiente)
 *   verificar-hmac  --kek F --actor A              (despues de activar: busqueda y repetidos)
 *
 * Archivos nuevos se crean con flag 'wx': nunca se sobrescribe una llave.
 */
import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { CategoriaLlave, ErrorCifrado, Llavero } from './cifrado';
import {
  AlmacenLlaves,
  Custodio,
  FilaLlaveCompleta,
  TipoEventoLlaves,
  aprovisionar,
  generarKek,
  recuperar,
  rotarActivar,
  rotarCrear,
  rotarKek,
  rotarRecuperacion,
  verificar,
} from './contingencia';
import { filasParaRecalculo, recalcularRutHmac, verificarRutHmac } from './recalculo-hmac';

const logger = new Logger('Llaves');

class AlmacenPrisma implements AlmacenLlaves {
  constructor(private readonly prisma: PrismaClient) {}

  async listar(): Promise<FilaLlaveCompleta[]> {
    const filas = await this.prisma.$queryRaw<
      {
        id: string;
        categoria: CategoriaLlave;
        version: number;
        activa: boolean;
        dek_por_kek: Buffer;
        dek_por_recuperacion: Buffer;
        huella_kek: string;
        canario: Buffer;
        retirada_en: Date | null;
      }[]
    >`SELECT id::text, categoria::text AS categoria, version, activa, dek_por_kek, dek_por_recuperacion,
             huella_kek, canario, retirada_en
      FROM llaves_datos ORDER BY categoria, version`;
    return filas.map((f) => ({
      id: f.id,
      categoria: f.categoria,
      version: f.version,
      activa: f.activa,
      dekPorKek: Buffer.from(f.dek_por_kek),
      dekPorRecuperacion: Buffer.from(f.dek_por_recuperacion),
      huellaKek: f.huella_kek,
      canario: Buffer.from(f.canario),
      retiradaEn: f.retirada_en,
    }));
  }

  async insertar(filas: FilaLlaveCompleta[], custodios: Custodio[]): Promise<void> {
    await this.prisma.$transaction([
      ...filas.map(
        (f) => this.prisma.$executeRaw`
          INSERT INTO llaves_datos (id, categoria, version, activa, dek_por_kek, dek_por_recuperacion, huella_kek, canario)
          VALUES (${f.id}::uuid, ${f.categoria}::categoria_llave, ${f.version}, ${f.activa}, ${f.dekPorKek},
                  ${f.dekPorRecuperacion}, ${f.huellaKek}, ${f.canario})`,
      ),
      ...custodios.map(
        (c) => this.prisma.$executeRaw`
          INSERT INTO custodios_llave (parte, custodio, rol) VALUES (${c.parte}, ${c.custodio}, ${c.rol})`,
      ),
    ]);
  }

  async activar(ids: string[]): Promise<void> {
    await this.prisma.$transaction(
      ids.flatMap((id) => [
        this.prisma.$executeRaw`
          UPDATE llaves_datos SET activa = false, retirada_en = now()
          WHERE activa AND categoria = (SELECT categoria FROM llaves_datos WHERE id = ${id}::uuid)`,
        this.prisma.$executeRaw`UPDATE llaves_datos SET activa = true WHERE id = ${id}::uuid`,
      ]),
    );
  }

  async reenvolver(cambios: { id: string; dekPorKek: Buffer; huellaKek: string }[]): Promise<void> {
    await this.prisma.$transaction(
      cambios.map(
        (c) => this.prisma.$executeRaw`
          UPDATE llaves_datos SET dek_por_kek = ${c.dekPorKek}, huella_kek = ${c.huellaKek} WHERE id = ${c.id}::uuid`,
      ),
    );
  }

  async reenvolverRecuperacion(cambios: { id: string; dekPorRecuperacion: Buffer }[], custodios: Custodio[]): Promise<void> {
    await this.prisma.$transaction([
      ...cambios.map(
        (c) => this.prisma.$executeRaw`
          UPDATE llaves_datos SET dek_por_recuperacion = ${c.dekPorRecuperacion} WHERE id = ${c.id}::uuid`,
      ),
      this.prisma.$executeRaw`UPDATE custodios_llave SET hasta = now() WHERE hasta IS NULL`,
      ...custodios.map(
        (c) => this.prisma.$executeRaw`
          INSERT INTO custodios_llave (parte, custodio, rol) VALUES (${c.parte}, ${c.custodio}, ${c.rol})`,
      ),
    ]);
  }

  async evento(tipo: TipoEventoLlaves, detalle: string, actor: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO eventos_llaves (tipo, detalle, actor) VALUES (${tipo}::tipo_evento_llaves, ${detalle}, ${actor})`;
  }
}

function argumentos(argv: string[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      throw new ErrorCifrado(`Argumento invalido: ${argv[i]}`);
    }
    mapa.set(argv[i].slice(2), [...(mapa.get(argv[i].slice(2)) ?? []), argv[i + 1]]);
  }
  return mapa;
}

function uno(args: Map<string, string[]>, nombre: string): string {
  const valor = args.get(nombre)?.[0];
  if (!valor) {
    throw new ErrorCifrado(`Falta --${nombre}`);
  }
  return valor;
}

function leerCustodios(texto: string): Custodio[] {
  return texto.split(',').map((c, i) => {
    const [custodio, rol] = c.split(':');
    return { parte: i + 1, custodio: custodio.trim(), rol: (rol ?? 'custodio').trim() };
  });
}

function leerKek(ruta: string): Buffer {
  const kek = readFileSync(ruta);
  if (kek.length !== 32) {
    throw new ErrorCifrado(`${ruta} no es una KEK de 32 bytes`);
  }
  return kek;
}

async function main(): Promise<void> {
  const [comando, ...resto] = process.argv.slice(2);
  const args = argumentos(resto);
  const actor = args.get('actor')?.[0] ?? 'operador';
  const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  const almacen = new AlmacenPrisma(prisma);
  try {
    switch (comando) {
      case 'aprovisionar': {
        const custodios = leerCustodios(uno(args, 'custodios'));
        await aprovisionar({ kekPath: uno(args, 'kek'), publicaPath: uno(args, 'publica'), partesDir: uno(args, 'partes'), custodios, actor }, almacen);
        logger.log('Aprovisionado. Entregar cada parte a su custodio y borrarlas de este equipo.');
        break;
      }
      case 'rotar-crear': {
        const categorias = uno(args, 'categorias').split(',') as CategoriaLlave[];
        const rotables = ['IDENTIFICACION', 'CLINICO', 'FINANCIERO', ...(args.has('compromiso-hmac') ? ['HMAC'] : [])];
        if (categorias.some((c) => !rotables.includes(c))) {
          throw new ErrorCifrado('Categorias rotables: IDENTIFICACION, CLINICO, FINANCIERO (HMAC solo ante compromiso: --compromiso-hmac)');
        }
        const nuevas = await rotarCrear(leerKek(uno(args, 'kek')), readFileSync(uno(args, 'publica'), 'utf8'), categorias, almacen, actor);
        logger.log(`Fase 1 lista: ${nuevas.map((f) => `${f.categoria} v${f.version}`).join(', ')}. Respaldar la BD y luego rotar-activar.`);
        break;
      }
      case 'rotar-activar':
        await rotarActivar(leerKek(uno(args, 'kek')), almacen, actor);
        logger.log('Fase 2 lista: versiones nuevas activas. Reiniciar la API para cargarlas.');
        break;
      case 'rotar-kek':
      case 'recuperar': {
        // Primero al disco: si la BD falla queda un archivo sin usar; al reves
        // quedarian DEKs envueltas con una KEK que no existe en ninguna parte.
        const kekNueva = generarKek();
        writeFileSync(uno(args, 'kek-nueva'), kekNueva, { flag: 'wx', mode: 0o600 });
        if (comando === 'rotar-kek') {
          await rotarKek(leerKek(uno(args, 'kek')), kekNueva, almacen, actor);
        } else {
          const partes = (args.get('parte') ?? []).map((p) => readFileSync(p));
          await recuperar(partes, kekNueva, almacen, actor);
        }
        logger.log(`KEK nueva escrita en ${uno(args, 'kek-nueva')}. Reemplazar el secret y reiniciar la API.`);
        break;
      }
      case 'verificar': {
        const via = args.has('kek') ? { kek: leerKek(uno(args, 'kek')) } : { partes: (args.get('parte') ?? []).map((p) => readFileSync(p)) };
        const filas = await almacen.listar();
        const fallos = await verificar(filas, via);
        const registrar = args.get('registrar')?.[0] as TipoEventoLlaves | undefined;
        if (registrar) {
          await almacen.evento(fallos.length ? 'FALLO_CANARIO' : registrar, fallos.join('; ') || `${filas.length} versiones OK`, actor);
        }
        if (fallos.length) {
          throw new ErrorCifrado(`Verificacion fallida: ${fallos.join('; ')}`);
        }
        logger.log(`Verificacion OK (${'kek' in via ? 'KEK' : 'recuperacion'}): ${filas.length} versiones.`);
        break;
      }
      case 'cambiar-custodios':
        await rotarRecuperacion(
          leerKek(uno(args, 'kek')),
          { publicaPath: uno(args, 'publica'), partesDir: uno(args, 'partes'), custodios: leerCustodios(uno(args, 'custodios')), actor },
          almacen,
        );
        logger.log('Par de recuperacion nuevo. Entregar las partes nuevas; las anteriores ya no sirven (destruirlas).');
        break;
      case 'recalcular-hmac': {
        const filas = filasParaRecalculo(await almacen.listar());
        const hmac = filas.find((f) => f.categoria === 'HMAC' && f.activa)!;
        const llavero = Llavero.cargar(leerKek(uno(args, 'kek')), filas);
        const resultados = await recalcularRutHmac(prisma, llavero, Number(args.get('lote')?.[0] ?? 500));
        const resumen = resultados.map((r) => `${r.tabla} ${r.actualizadas}/${r.conRut}`).join(', ');
        logger.log(`rut_hmac recalculados con HMAC v${hmac.version}: ${resumen}`);
        const duplicados = resultados.flatMap((r) => r.duplicados.map((id) => `${r.tabla}:${id}`));
        await almacen.evento('ROTACION', `recalculo rut_hmac con HMAC v${hmac.version}: ${resumen}; duplicados ${duplicados.length}`, actor);
        if (duplicados.length) {
          throw new ErrorCifrado(`RUT duplicados (resolver a mano y volver a correr): ${duplicados.join(', ')}`);
        }
        break;
      }
      case 'verificar-hmac': {
        const filas = await almacen.listar();
        const llavero = Llavero.cargar(leerKek(uno(args, 'kek')), filas);
        const resultados = await verificarRutHmac(prisma, llavero);
        const resumen = resultados.map((r) => `${r.tabla} ${r.coinciden}/${r.conRut} (repetidos ${r.repetidos})`).join(', ');
        const fallos = resultados.filter((r) => r.coinciden !== r.conRut || (r.tabla !== 'adultos_responsables' && r.repetidos > 0));
        const version = filas.find((f) => f.categoria === 'HMAC' && f.activa)!.version;
        await almacen.evento(fallos.length ? 'FALLO_CANARIO' : 'VERIFICACION', `rut_hmac con HMAC v${version}: ${resumen}`, actor);
        if (fallos.length) {
          throw new ErrorCifrado(`rut_hmac no verifica: ${resumen}`);
        }
        logger.log(`rut_hmac OK con HMAC v${version}: ${resumen}`);
        break;
      }
      case 'registrar':
        await almacen.evento(uno(args, 'tipo') as TipoEventoLlaves, uno(args, 'detalle'), actor);
        break;
      default:
        throw new ErrorCifrado(`Comando desconocido: ${comando ?? '(ninguno)'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const mensaje = error instanceof Prisma.PrismaClientKnownRequestError ? `${error.code} ${error.message}` : (error as Error).message;
  logger.error(mensaje);
  process.exitCode = 1;
});
