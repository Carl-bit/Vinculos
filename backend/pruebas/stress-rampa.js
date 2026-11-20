// Estres creciente: punto de quiebre de un silo (Vinculos Control, seccion 13
// de CONTEXTO.md: "Estres | k6 con carga creciente | punto de quiebre por silo
// y del host"). Solo contra silos de prueba (estres, estres-limpio), nunca
// contra un centro real.
//
// Etapas (decision del usuario 2026-11-20): 10, 25, 50, 100 y 200 VUs, 2
// minutos cada una (15 s de subida + 1 min 45 s estable). Criterio de quiebre
// por etapa: p95 > 300 ms o mas de 1 % de respuestas 5xx. La primera etapa que
// lo cumple es el punto de quiebre; las siguientes se miden igual.
//
// Mezcla por iteracion (solo lecturas: la prueba se puede repetir sin hacer
// crecer la BD): 7 de cada 10 VUs leen el sitio publico (centro, catalogo y
// disponibilidad de 14 dias) y 3 de cada 10 son del equipo (ocupacion de boxes
// y citas de 7 dias, con el token de setup). Pausa de 1 s entre iteraciones.
//
// Variables (k6 run -e ...): API_URL, MAILPIT_URL, EMAIL, PASSWORD, SALIDA
// (archivo JSON con el resumen por etapa, ej. /out/rampa.json).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const API = __ENV.API_URL || 'http://erp-estres-backend-1:3001/api';
const MAILPIT = __ENV.MAILPIT_URL || 'http://mailpit:8025';
const EMAIL = __ENV.EMAIL || 'gestion@centro-prueba.cl';
const PASSWORD = __ENV.PASSWORD || 'dev-password';
const SALIDA = __ENV.SALIDA || '';

const ETAPAS = [10, 25, 50, 100, 200];
const ETAPA_MS = 120000;
const UMBRAL_P95_MS = 300;
const UMBRAL_5XX = 0.01;

const errores5xx = new Rate('errores_5xx');
const limitadas = new Counter('respuestas_429');

const stages = ETAPAS.flatMap((vus) => [
  { duration: '15s', target: vus },
  { duration: '1m45s', target: vus },
]);
stages.push({ duration: '15s', target: 0 });

// Umbrales por etapa: k6 solo calcula las submetricas que tienen un umbral.
const thresholds = {};
for (const vus of ETAPAS) {
  thresholds[`http_req_duration{etapa:${vus}}`] = [`p(95)<${UMBRAL_P95_MS}`];
  thresholds[`errores_5xx{etapa:${vus}}`] = [`rate<${UMBRAL_5XX}`];
  thresholds[`http_reqs{etapa:${vus}}`] = ['count>=0'];
}

export const options = {
  setupTimeout: '60s',
  scenarios: { rampa: { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '15s' } },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

const json = { 'Content-Type': 'application/json' };

function codigoDelCorreo(para, desde) {
  for (let i = 0; i < 30; i++) {
    const r = http.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`);
    for (const m of r.json('messages') || []) {
      if (Date.parse(m.Created) < desde - 2000) continue;
      const t = http.get(`${MAILPIT}/api/v1/message/${m.ID}`).json('Text') || '';
      const c = /\b(\d{6})\b/.exec(t);
      if (c) return c[1];
    }
    sleep(0.5);
  }
  throw new Error('sin codigo de verificacion en Mailpit');
}

export function setup() {
  const desde = Date.now();
  const d = http.post(`${API}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), { headers: json });
  if (d.status !== 200) throw new Error(`login ${d.status} ${d.body}`);
  let token = d.json('accessToken');
  if (!token) {
    const v = http.post(`${API}/auth/segundo-factor`, JSON.stringify({ desafio: d.json('desafio'), codigo: codigoDelCorreo(EMAIL, desde) }), { headers: json });
    if (v.status !== 200) throw new Error(`segundo factor ${v.status} ${v.body}`);
    token = v.json('accessToken');
  }
  const perfiles = http.get(`${API}/publico/profesionales`).json();
  if (!Array.isArray(perfiles) || perfiles.length === 0) throw new Error('el silo no tiene profesionales publicados');
  return { token, perfil: perfiles[0].id, inicio: Date.now() };
}

/** Etapa segun el tiempo transcurrido (cada etapa dura 2 min, contando su subida). */
function etapaActual(inicio) {
  const i = Math.min(Math.floor((Date.now() - inicio) / ETAPA_MS), ETAPAS.length - 1);
  return String(ETAPAS[i]);
}

function pedir(url, nombre, etapa, params) {
  const r = http.get(url, { ...(params || {}), tags: { name: nombre, etapa } });
  errores5xx.add(r.status >= 500, { etapa });
  if (r.status === 429) limitadas.add(1, { etapa });
  check(r, { 'respuesta 200': (x) => x.status === 200 }, { etapa });
  return r;
}

export default function (d) {
  const etapa = etapaActual(d.inicio);
  const ahora = Date.now();
  if (__VU % 10 < 3) {
    const auth = { headers: { Authorization: `Bearer ${d.token}` } };
    const desde = new Date(ahora).toISOString();
    const hasta = new Date(ahora + 7 * 86400000).toISOString();
    pedir(`${API}/espacios/ocupacion?desde=${desde}&hasta=${hasta}`, 'ocupacion', etapa, auth);
    pedir(`${API}/citas?desde=${desde}&hasta=${hasta}`, 'citas', etapa, auth);
  } else {
    pedir(`${API}/publico/centro`, 'centro', etapa);
    pedir(`${API}/publico/profesionales`, 'profesionales', etapa);
    const hasta = new Date(ahora + 14 * 86400000).toISOString();
    pedir(`${API}/publico/profesionales/${d.perfil}/disponibilidad?desde=${new Date(ahora).toISOString()}&hasta=${hasta}`, 'disponibilidad', etapa);
  }
  sleep(1);
}

const num = (x) => (typeof x === 'number' ? x : null);

export function handleSummary(data) {
  const m = data.metrics;
  const filas = ETAPAS.map((vus) => {
    const dur = m[`http_req_duration{etapa:${vus}}`];
    const err = m[`errores_5xx{etapa:${vus}}`];
    const reqs = m[`http_reqs{etapa:${vus}}`];
    const p95 = num(dur && dur.values['p(95)']);
    const tasa = num(err && err.values.rate);
    const cantidad = num(reqs && reqs.values.count) || 0;
    const quiebra = cantidad > 0 && ((p95 !== null && p95 > UMBRAL_P95_MS) || (tasa !== null && tasa > UMBRAL_5XX));
    return {
      vus,
      peticiones: cantidad,
      por_segundo: Math.round((cantidad / (ETAPA_MS / 1000)) * 10) / 10,
      p95_ms: p95 === null ? null : Math.round(p95),
      max_ms: dur ? Math.round(dur.values.max) : null,
      errores_5xx: tasa === null ? null : Math.round(tasa * 10000) / 100,
      quiebra,
    };
  });
  const primera = filas.find((f) => f.quiebra);
  const res429 = m.respuestas_429 ? m.respuestas_429.values.count : 0;
  const resumen = {
    api: API,
    criterio: `p95 > ${UMBRAL_P95_MS} ms o 5xx > ${UMBRAL_5XX * 100} %`,
    punto_de_quiebre_vus: primera ? primera.vus : null,
    respuestas_429: res429,
    etapas: filas,
  };
  const txt = [
    `Rampa contra ${API}`,
    `Criterio de quiebre: ${resumen.criterio}`,
    '',
    'VUs   peticiones  por seg   p95 ms   max ms   5xx %   quiebre',
    ...filas.map(
      (f) =>
        `${String(f.vus).padEnd(6)}${String(f.peticiones).padEnd(12)}${String(f.por_segundo).padEnd(10)}${String(f.p95_ms === null ? '-' : f.p95_ms).padEnd(9)}${String(f.max_ms === null ? '-' : f.max_ms).padEnd(9)}${String(f.errores_5xx === null ? '-' : f.errores_5xx).padEnd(8)}${f.quiebra ? 'SI' : 'no'}`,
    ),
    '',
    primera ? `Punto de quiebre: ${primera.vus} VUs` : 'Sin quiebre hasta 200 VUs',
    res429 ? `Atencion: ${res429} respuestas 429 (limite por IP o Cloudflare): no son capacidad del silo` : '',
    '',
  ].join('\n');
  const salida = { stdout: txt };
  if (SALIDA) salida[SALIDA] = JSON.stringify(resumen, null, 2);
  return salida;
}
