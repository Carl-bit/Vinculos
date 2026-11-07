#!/usr/bin/env node
// 03b-6: la fuente de iconos (Material Symbols Rounded) se aloja en el repo,
// recortada a los glifos de src/lib/iconos.ts. Asi el navegador no llama a
// Google en ninguna vista (tampoco en las clinicas). Correr al agregar o
// quitar un icono de la lista:
//   npm run iconos
// Escribe src/app/fuentes/material-symbols-rounded.woff2 (unos 140 KB).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuente = readFileSync(join(raiz, 'src/lib/iconos.ts'), 'utf8');
const nombres = [...fuente.matchAll(/^ {2}'([a-z0-9_]+)',$/gm)].map((m) => m[1]);
if (nombres.length === 0) throw new Error('No se encontro la lista ICONOS en src/lib/iconos.ts');

// Mismos ejes que usa .ms en globals.css (peso 400 a 700, relleno 0 o 1). Google exige los nombres en orden alfabetico.
const css = await (
  await fetch(
    `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&display=block&icon_names=${[...nombres].sort().join(',')}`,
    // Con un navegador moderno Google entrega WOFF2.
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } },
  )
).text();
const url = /url\((https:\/\/fonts\.gstatic\.com[^)]+)\)\s*format\('woff2'\)/.exec(css)?.[1];
if (!url) throw new Error(`Respuesta inesperada de Google Fonts:\n${css.slice(0, 300)}`);
const archivo = Buffer.from(await (await fetch(url)).arrayBuffer());
if (archivo.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error('El archivo descargado no es WOFF2');
const destino = join(raiz, 'src/app/fuentes/material-symbols-rounded.woff2');
writeFileSync(destino, archivo);
console.log(`${nombres.length} iconos -> ${destino} (${(archivo.length / 1024).toFixed(0)} KB)`);
