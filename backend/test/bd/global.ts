/**
 * globalSetup / globalTeardown de Jest e2e: una BD efimera (Postgres 18
 * local, sin Docker) para toda la corrida. Los tests corren en serie
 * (--runInBand) sobre esa BD; cada test crea sus propios datos.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVO_ENTORNO = join(__dirname, '.entorno-test.json');

export interface EntornoTest {
  dir: string;
  secretos: string;
  ownerUrl: string;
  appUrl: string;
  kek: string;
  publica: string;
}

export function leerEntorno(): EntornoTest {
  return JSON.parse(readFileSync(ARCHIVO_ENTORNO, 'utf8')) as EntornoTest;
}

export default function levantar(): void {
  execFileSync('sh', ['test/bd/levantar.sh', ARCHIVO_ENTORNO], { cwd: join(__dirname, '..', '..'), stdio: 'inherit' });
}

export function bajar(): void {
  const e = leerEntorno();
  execFileSync('sh', ['test/bd/bajar.sh', e.dir, e.secretos], { stdio: 'inherit' });
}
