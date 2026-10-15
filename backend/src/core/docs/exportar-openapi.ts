/**
 * Exporta el documento OpenAPI a docs/api/openapi.json (npm run openapi:exportar).
 * Corre desde dist (nest build): el plugin de @nestjs/swagger solo actua al
 * compilar con el CLI de Nest. Modo preview: arma el grafo de modulos sin
 * instanciar providers (no conecta a la BD ni lee la KEK); las variables
 * obligatorias se rellenan solo para pasar la validacion del entorno.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { documentoOpenApi } from './openapi';

const RELLENO: Record<string, string> = {
  DATABASE_URL: 'postgresql://sin-conexion@localhost/app',
  JWT_SECRET: 'solo-para-exportar-openapi-000000000000',
  KEK_PATH: 'sin-kek',
  RECUPERACION_PUBLICA_PATH: 'sin-publica',
  JOBS_HABILITADOS: 'false',
};

async function exportar(): Promise<void> {
  for (const [clave, valor] of Object.entries(RELLENO)) {
    process.env[clave] ??= valor;
  }
  const app = await NestFactory.create(AppModule.crear(), { preview: true, logger: false });
  app.setGlobalPrefix('api');
  const destino = join(__dirname, '..', '..', '..', '..', 'docs', 'api', 'openapi.json');
  const documento = documentoOpenApi(app);
  writeFileSync(destino, `${JSON.stringify(documento, null, 2)}\n`);
  process.stdout.write(`OpenAPI: ${Object.keys(documento.paths).length} rutas -> ${destino}\n`);
  await app.close();
}

void exportar();
