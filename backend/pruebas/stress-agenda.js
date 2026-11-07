// Estres de agenda y capacidad (prompts/04_pruebas.md fases 2 y 3; AUD-02 CAP-03).
// Solo contra el silo de estres efimero (infra/stress/levantar.sh), nunca contra
// el tenant de prueba real ni produccion.
//
// La metrica que importa no es el throughput: despues de la corrida no puede
// haber dos citas activas solapadas del mismo profesional ni del mismo box
// (consulta en pruebas/README.md, la corre infra/stress/verificar.sh).
//
// Desde 03b la cita no recibe box: la BD lo asigna desde el bloque del
// profesional. El choque real es el mismo profesional en el mismo horario; el
// EXCLUDE del profesional (y el del box, que hereda el bloque) deben dejar
// exactamente una por ronda.
//
// Escenarios:
//   carga_normal     10 VUs del equipo: ocupacion de boxes y citas de 7 dias.
//   lectura_publica  20 VUs: centro, catalogo y disponibilidad de 14 dias
//                    (umbral p95 < 300 ms y 0 % de 5xx).
//   colision_reserva 30 VUs (COLISION_VUS) x 3 rondas sobre el mismo profesional y horario.
//
// Variables (k6 run -e ...): API_URL, MAILPIT_URL, EMAIL, PASSWORD, DURACION.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const API = __ENV.API_URL || 'http://erp-stress-backend-1:3001/api';
const MAILPIT = __ENV.MAILPIT_URL || 'http://erp-stress-mailpit-1:8025';
const EMAIL = __ENV.EMAIL || 'gestion@centro-prueba.cl';
const PASSWORD = __ENV.PASSWORD || 'dev-password';
const DURACION = __ENV.DURACION || '5m';
const RONDAS = 3;

const confirmadas = new Counter('reservas_201');
const rechazadas = new Counter('reservas_409');
const ocupado = new Counter('reservas_503_pool');
const otras = new Counter('reservas_otro_estado');

export const options = {
  setupTimeout: '60s',
  scenarios: {
    carga_normal: { executor: 'constant-vus', exec: 'cargaNormal', vus: 10, duration: DURACION, tags: { escenario: 'carga_normal' } },
    lectura_publica: { executor: 'constant-vus', exec: 'lecturaPublica', vus: 20, duration: DURACION, tags: { escenario: 'lectura_publica' } },
    colision_reserva: {
      executor: 'per-vu-iterations',
      exec: 'colisionReserva',
      // COLISION_VUS sube la rafaga para el caso extremo (p. ej. 60).
      vus: Number(__ENV.COLISION_VUS || 30),
      iterations: RONDAS,
      startTime: '30s',
      maxDuration: '2m',
      tags: { escenario: 'colision' },
    },
  },
  thresholds: {
    'http_req_duration{escenario:lectura_publica}': ['p(95)<300'],
    'checks{escenario:lectura_publica}': ['rate==1'],
    'checks{escenario:carga_normal}': ['rate==1'],
    // Una sola reserva por ronda; el resto 409 (o 503 si el pool se satura). Cualquier otro estado es un error.
    reservas_201: [`count==${RONDAS}`],
    reservas_otro_estado: ['count==0'],
  },
};

const json = { 'Content-Type': 'application/json' };
const conToken = (token) => ({ headers: { ...json, Authorization: `Bearer ${token}` } });
const iso = (ms) => new Date(ms).toISOString();
// Agrupa las URL con fechas o ids en una sola serie de metricas.
const nombre = (n) => ({ tags: { name: n } });

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
    const v = http.post(`${API}/auth/segundo-factor`, JSON.stringify({ desafio: d.json('desafio'), codigo: codigoDelCorreo(EMAIL, desde) }), {
      headers: json,
    });
    if (v.status !== 200) throw new Error(`segundo factor ${v.status} ${v.body}`);
    token = v.json('accessToken');
  }

  // Profesional publicado con al menos RONDAS huecos libres en 14 dias y pacientes adultos sin deuda.
  const ahora = Date.now();
  const perfiles = http.get(`${API}/publico/profesionales`).json();
  const deudas = new Set((http.get(`${API}/cobros/deudas`, conToken(token)).json() || []).map((x) => x.paciente_id));
  const adultoHasta = ahora - 18 * 365.25 * 86400000;
  for (const p of perfiles) {
    const id = p.id;
    const huecos = http.get(`${API}/publico/profesionales/${id}/disponibilidad?desde=${iso(ahora + 2 * 86400000)}&hasta=${iso(ahora + 14 * 86400000)}`).json() || [];
    const pacientes = (http.get(`${API}/pacientes/resumen?profesionalId=${id}`, conToken(token)).json() || [])
      .filter((x) => Date.parse(x.fechaNacimiento) < adultoHasta && !deudas.has(x.id))
      .map((x) => x.id);
    // Huecos de una hora completa, separados entre si (cada ronda en uno distinto).
    const slots = [];
    for (const h of huecos) {
      if (slots.length === RONDAS) break;
      // A la hora siguiente en punto (el hueco puede empezar en "ahora + 2 dias" con segundos) y con la sesion completa dentro.
      const ini = Math.ceil(Date.parse(h.inicio) / 3600000) * 3600000;
      if (ini + 50 * 60000 > Date.parse(h.fin)) continue;
      if (slots.every((s) => Math.abs(Date.parse(s.inicio) - ini) >= 2 * 3600000)) slots.push({ inicio: iso(ini), fin: iso(ini + 50 * 60000), modalidad: h.modalidad });
    }
    if (slots.length === RONDAS && pacientes.length > 0) {
      return { token, profesionalId: id, pacientes, slots, perfil: id };
    }
  }
  throw new Error('ningun profesional publicado con huecos y pacientes adultos sin deuda');
}

export function cargaNormal(d) {
  const desde = iso(Date.now());
  const hasta = iso(Date.now() + 7 * 86400000);
  const ocupacion = http.get(`${API}/espacios/ocupacion?desde=${desde}&hasta=${hasta}`, { ...conToken(d.token), ...nombre('ocupacion') });
  const citas = http.get(`${API}/citas?desde=${desde}&hasta=${hasta}`, { ...conToken(d.token), ...nombre('citas') });
  check(ocupacion, { 'ocupacion 200': (r) => r.status === 200 });
  check(citas, { 'citas 200': (r) => r.status === 200 });
  sleep(1);
}

export function lecturaPublica(d) {
  const ahora = Date.now();
  const rutas = [
    ['/publico/centro', 'centro'],
    ['/publico/profesionales', 'profesionales'],
    [`/publico/profesionales/${d.perfil}/disponibilidad?desde=${iso(ahora)}&hasta=${iso(ahora + 14 * 86400000)}`, 'disponibilidad'],
  ];
  for (const [ruta, n] of rutas) {
    const r = http.get(`${API}${ruta}`, nombre(n));
    check(r, { 'publico 200 (sin 5xx ni 429)': (x) => x.status === 200 });
  }
  sleep(1);
}

export function colisionReserva(d) {
  // Ronda = iteracion. Todos los VUs esperan el mismo borde de 5 s para chocar a la vez.
  sleep((5000 - (Date.now() % 5000)) / 1000);
  const slot = d.slots[__ITER];
  const r = http.post(
    `${API}/citas`,
    JSON.stringify({
      profesionalId: d.profesionalId,
      pacienteId: d.pacientes[(__VU - 1) % d.pacientes.length],
      modalidad: slot.modalidad === 'ONLINE' ? 'ONLINE' : 'PRESENCIAL',
      inicio: slot.inicio,
      fin: slot.fin,
    }),
    conToken(d.token),
  );
  if (r.status === 201) confirmadas.add(1);
  else if (r.status === 409) rechazadas.add(1);
  // Pool de conexiones saturado (Prisma P2028): 503 con Retry-After; el cliente reintenta.
  else if (r.status === 503) ocupado.add(1);
  else {
    otras.add(1);
    console.warn(`colision: ${r.status} ${r.body}`);
  }
  check(r, { 'colision 201, 409 o 503': (x) => [201, 409, 503].includes(x.status) });
}
