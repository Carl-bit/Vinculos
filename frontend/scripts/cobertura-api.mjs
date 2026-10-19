/**
 * Cobertura del OpenAPI por el front (criterio de cierre de 03b-5).
 * Falla (exit 1) si:
 *  - una operacion no la usa ninguna pantalla y no tiene una justificacion
 *    en scripts/cobertura-api.excepciones.json, o
 *  - el front usa una operacion sin schema de respuesta (tipos a mano).
 * Uso: npm run api:cobertura (desde frontend/).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const openapi = JSON.parse(readFileSync(join(raiz, '../docs/api/openapi.json'), 'utf8'));
const excepciones = JSON.parse(readFileSync(join(raiz, 'scripts/cobertura-api.excepciones.json'), 'utf8'));

const archivos = [];
(function recorrer(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) recorrer(p);
    else if (/\.tsx?$/.test(f.name) && !/\.test\.tsx?$/.test(f.name) && f.name !== 'esquema.d.ts') archivos.push(p);
  }
})(join(raiz, 'src'));

// Ruta del OpenAPI y del codigo a una forma comparable: /api/x/{} (parametros y ${...} da igual el nombre).
const forma = (ruta) => ruta.replace(/\$\{[^}]+\}/g, '{}').replace(/\{[^}]+\}/g, '{}').replace(/\?.*$/, '');

const operaciones = [];
for (const [ruta, ops] of Object.entries(openapi.paths)) {
  for (const [metodo, op] of Object.entries(ops)) {
    const ok = Object.entries(op.responses ?? {}).find(([c]) => c.startsWith('2'));
    const contenido = ok?.[1].content;
    const conSchema = !!ok && (ok[0] === '204' || (contenido && Object.values(contenido).some((c) => c.schema)));
    operaciones.push({ clave: `${metodo.toUpperCase()} ${ruta}`, metodo: metodo.toUpperCase(), forma: forma(ruta), conSchema, modulo: op.tags?.[0] ?? '' });
  }
}

const usadas = new Set();
const marcar = (metodo, ruta) => {
  const f = forma(ruta);
  for (const o of operaciones) if (o.forma === f && (!metodo || o.metodo === metodo)) usadas.add(o.clave);
};
const HELPERS = { subirArchivo: 'POST', pedirArchivo: 'POST', descargarArchivo: 'GET' };
for (const a of archivos) {
  const t = readFileSync(a, 'utf8');
  for (const m of t.matchAll(/\bapi\.(GET|POST|PUT|PATCH|DELETE)\(\s*['"`](\/api\/[^'"`]+)/g)) marcar(m[1], m[2]);
  // Helpers binarios: la ruta puede venir en un ternario (p. ej. foto propia o de otro): toda ruta del primer argumento.
  for (const m of t.matchAll(/\b(subirArchivo|pedirArchivo|descargarArchivo)(?:<[^>]*>)?\(([^;]{0,300})/g)) {
    for (const r of m[2].matchAll(/['"`](\/api\/[^'"`]+)['"`]/g)) marcar(HELPERS[m[1]], r[1]);
  }
  // Proxy de sesion (app/sesion/[accion]): todas las rutas de auth van por POST.
  if (a.includes(join('app', 'sesion'))) for (const m of t.matchAll(/['"`](\/api\/auth\/[^'"`]+)['"`]/g)) marcar('POST', m[1]);
}

const sinUso = operaciones.filter((o) => !usadas.has(o.clave) && !excepciones[o.clave]);
const sinSchema = operaciones.filter((o) => usadas.has(o.clave) && !o.conSchema);
const sobrantes = Object.keys(excepciones).filter((k) => !operaciones.some((o) => o.clave === k) || usadas.has(k));

const porModulo = (lista) =>
  Object.entries(Object.groupBy(lista, (o) => o.modulo))
    .map(([m, l]) => `  ${m} (${l.length})\n` + l.map((o) => `    ${o.clave}`).join('\n'))
    .join('\n');

console.log(`OpenAPI: ${operaciones.length} operaciones | usadas: ${usadas.size} | excepciones: ${Object.keys(excepciones).length}`);
if (sinUso.length) console.log(`\nSin pantalla ni excepcion (${sinUso.length}):\n${porModulo(sinUso)}`);
if (sinSchema.length) console.log(`\nUsadas sin schema de respuesta (${sinSchema.length}):\n${porModulo(sinSchema)}`);
if (sobrantes.length) console.log(`\nExcepciones que sobran (ya se usan o no existen):\n  ${sobrantes.join('\n  ')}`);
if (sinUso.length || sinSchema.length || sobrantes.length) process.exit(1);
console.log('Cobertura completa.');
