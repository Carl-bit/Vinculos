// Estres de agenda (prompts/04_pruebas.md, fase 2). Preparado en 02d; NO se
// corre sin Docker: siempre contra docker-compose.stress.yml con BD efimera,
// nunca contra el tenant de prueba real ni produccion.
//
// La metrica que importa no es el throughput: es que despues de la corrida
// no haya dos citas CONFIRMADA solapadas en el mismo box (query en README.md).
//
// Variables (k6 run -e ...):
//   API_URL        p. ej. http://localhost:3001/api
//   EMAIL/PASSWORD usuario GESTION o ADMIN del silo de estres
//   ESPACIO_ID     box sobre el que chocan todas las reservas
//   PROFESIONALES  ids separados por coma (con disponibilidad 24x7)
//   PACIENTES      ids separados por coma, uno por profesional (mismo orden)
//   DIA            dia de la colision (YYYY-MM-DD, futuro)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:3001/api';
const profesionales = (__ENV.PROFESIONALES || '').split(',').filter(Boolean);
const pacientes = (__ENV.PACIENTES || '').split(',').filter(Boolean);
const confirmadas = new Counter('reservas_confirmadas');
const rechazadas = new Counter('reservas_rechazadas_409');

export const options = {
  scenarios: {
    carga_normal: {
      executor: 'ramping-vus',
      exec: 'cargaNormal',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
    colision_reserva: {
      executor: 'per-vu-iterations',
      exec: 'colisionReserva',
      vus: 30,
      iterations: 3,
      startTime: '10s',
    },
  },
  thresholds: {
    // Una sola reserva confirmada por ronda de colision (3 rondas).
    reservas_confirmadas: ['count<=3'],
    'checks{escenario:colision}': ['rate==1'],
  },
};

export function setup() {
  const r = http.post(`${API}/auth/login`, JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(r, { 'login 200': (x) => x.status === 200 });
  return { token: r.json('accessToken') };
}

const cabeceras = (token) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });

export function cargaNormal(datos) {
  const desde = new Date().toISOString();
  const hasta = new Date(Date.now() + 7 * 86400000).toISOString();
  const ocupacion = http.get(`${API}/espacios/ocupacion?desde=${desde}&hasta=${hasta}`, cabeceras(datos.token));
  check(ocupacion, { 'ocupacion 200': (r) => r.status === 200 });
  const citas = http.get(`${API}/citas?desde=${desde}&hasta=${hasta}`, cabeceras(datos.token));
  check(citas, { 'citas 200': (r) => r.status === 200 });
  sleep(1);
}

export function colisionReserva(datos) {
  // Mismo box y horario para todos los VUs de la ronda (la ronda es la
  // iteracion); profesionales distintos: lo que choca es el EXCLUDE del box.
  const i = (__VU - 1) % profesionales.length;
  const hora = 10 + __ITER;
  const payload = JSON.stringify({
    pacienteId: pacientes[i],
    profesionalId: profesionales[i],
    modalidad: 'PRESENCIAL',
    espacioId: __ENV.ESPACIO_ID,
    inicio: `${__ENV.DIA}T${String(hora).padStart(2, '0')}:00:00Z`,
    fin: `${__ENV.DIA}T${String(hora).padStart(2, '0')}:50:00Z`,
  });
  const r = http.post(`${API}/citas`, payload, cabeceras(datos.token));
  if (r.status === 201) confirmadas.add(1);
  if (r.status === 409) rechazadas.add(1);
  check(r, { 'status 201 o 409, nunca otro': (x) => x.status === 201 || x.status === 409 }, { escenario: 'colision' });
}
