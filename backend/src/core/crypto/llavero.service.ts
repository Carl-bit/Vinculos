import { existsSync, readFileSync } from 'node:fs';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { aad, ErrorCifrado, type FilaLlave, Llavero } from '../../common/crypto/cifrado';
import { CAMPOS_CIFRADOS } from '../../common/crypto/registro';
import { PrismaService } from '../prisma/prisma.service';

interface FilaLlaveBd {
  id: string;
  categoria: FilaLlave['categoria'];
  version: number;
  activa: boolean;
  dek_por_kek: Uint8Array;
  huella_kek: string;
  canario: Uint8Array;
}

/**
 * Llavero de la API (docs/seguridad/cifrado.md, requisitos_02_apis.md 3).
 * Se carga al arrancar, antes que cualquier modulo que toque datos: KEK desde
 * archivo (KEK_PATH, Docker secret), DEKs desde llaves_vigentes() (sin
 * contexto). Falla cerrado: si la KEK falta, no mide 32 bytes, su huella no
 * coincide, un canario no verifica o falta una DEK activa por categoria, la
 * API no arranca. Nunca hay un modo "sin cifrado".
 */
@Injectable()
export class LlaveroService implements OnModuleInit {
  private readonly logger = new Logger(LlaveroService.name);
  private cargado?: Llavero;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!existsSync(this.config.getOrThrow<string>('RECUPERACION_PUBLICA_PATH'))) {
      throw new ErrorCifrado('Falta la llave publica de recuperacion (RECUPERACION_PUBLICA_PATH)');
    }
    try {
      this.cargado = await this.verificar();
    } catch (error) {
      await this.registrarFallo(error);
      throw error;
    }
    await this.registrarEvento('VERIFICACION', 'arranque de la API: huella y canarios OK');
    this.logger.log('Llavero cargado: huella de la KEK y canarios verificados');
  }

  get llavero(): Llavero {
    if (!this.cargado) {
      throw new ErrorCifrado('Llavero no cargado');
    }
    return this.cargado;
  }

  /**
   * Lee la KEK montada y verifica todas las versiones de DEK (huella y
   * canarios). La usan el arranque, el job diario y /salud. No registra nada.
   */
  async verificar(): Promise<Llavero> {
    let kek: Buffer;
    try {
      kek = readFileSync(this.config.getOrThrow<string>('KEK_PATH'));
    } catch {
      throw new ErrorCifrado('No se pudo leer la KEK (KEK_PATH)');
    }
    const filas = await this.prisma.$queryRaw<FilaLlaveBd[]>`
      SELECT id::text, categoria::text AS categoria, version, activa, dek_por_kek, huella_kek, canario
      FROM llaves_vigentes()`;
    return Llavero.cargar(
      kek,
      filas.map((f) => ({
        id: f.id,
        categoria: f.categoria,
        version: f.version,
        activa: f.activa,
        dekPorKek: Buffer.from(f.dek_por_kek),
        huellaKek: f.huella_kek,
        canario: Buffer.from(f.canario),
      })),
    );
  }

  /** Job diario: verifica y registra. Devuelve false (y alerta) si falla. */
  async verificarYRegistrar(): Promise<boolean> {
    try {
      this.cargado = await this.verificar();
    } catch (error) {
      await this.registrarFallo(error);
      await this.prisma.$executeRaw`SELECT alertar_fallo_canario(${this.detalleSeguro(error)})`;
      this.logger.error(`Verificacion de canarios FALLO: ${this.detalleSeguro(error)}`);
      return false;
    }
    await this.registrarEvento('VERIFICACION', 'verificacion diaria: huella y canarios OK');
    return true;
  }

  /**
   * Descifra una columna de registro.ts que llega por $queryRaw (funciones
   * SQL: la extension de Prisma no las ve). AAD de la fila de origen.
   */
  descifrarCampo(valor: Uint8Array | null | undefined, tabla: string, columna: string, idFila: string): string | null {
    if (valor === null || valor === undefined) {
      return null;
    }
    this.campo(tabla, columna);
    return this.llavero.descifrar(Buffer.from(valor), aad(tabla, columna, idFila));
  }

  /** Cifra para pasar a una funcion SQL que recibe el bytea (crear_derivacion). */
  cifrarCampo(valor: string, tabla: string, columna: string, idFila: string): Buffer {
    return this.llavero.cifrar(valor, this.campo(tabla, columna).categoria, aad(tabla, columna, idFila));
  }

  /** Indice ciego del RUT normalizado (busqueda exacta: where rutHmac). */
  hmacRut(rut: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.llavero.hmacRut(rut));
  }

  private campo(tabla: string, columna: string) {
    const c = CAMPOS_CIFRADOS.find((x) => x.tabla === tabla && x.columna === columna);
    if (!c) {
      throw new ErrorCifrado(`${tabla}.${columna} no esta en registro.ts`);
    }
    return c;
  }

  /** Mensajes de ErrorCifrado: categoria y version, nunca llaves ni datos. */
  private detalleSeguro(error: unknown): string {
    return error instanceof ErrorCifrado ? error.message : 'error al verificar llaves';
  }

  private async registrarFallo(error: unknown): Promise<void> {
    await this.registrarEvento('FALLO_CANARIO', this.detalleSeguro(error)).catch(() => undefined);
  }

  private async registrarEvento(tipo: 'VERIFICACION' | 'FALLO_CANARIO', detalle: string): Promise<void> {
    await this.prisma.$executeRaw`SELECT registrar_evento_llaves(${tipo}::tipo_evento_llaves, ${detalle})`;
  }
}
