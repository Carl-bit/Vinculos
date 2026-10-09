# Prompt - Seccion Pruebas (Back)

Lee CLAUDE.md y los modulos ya generados (seccion APIs) antes de empezar.
Corre despues de 02_apis.md, idealmente antes o en paralelo a 03_front.md
(encontrar un bug de concurrencia en la agenda ahora es mas barato que
despues de construir UI encima). Cubre solo el backend: el estres del
front es otro problema (UI que se traba para un usuario, no datos
corruptos para todos los clientes) y no entra en este prompt.

## Fase 1: integracion (Jest + Supertest)

NestJS ya trae Jest. Usar `@nestjs/testing` para levantar el `TestingModule`
real y Supertest contra la app compilada, nunca contra la DB del tenant de
prueba real: una DB efimera aparte.

1. `docker-compose.test.yml`: servicio Postgres propio, puerto distinto al
   de desarrollo, con `btree_gist` habilitado igual que en produccion.
2. Antes de cada corrida: `prisma migrate deploy` contra esa DB, despues
   truncar tablas entre tests (`TRUNCATE ... RESTART IDENTITY CASCADE`).
3. Script: `"test:integration": "cross-env NODE_ENV=test jest --config
   ./test/jest-e2e.json --detectOpenHandles"`.

Priorizar estos casos sobre cobertura general (mismo criterio que
02_apis.md: los tres puntos donde un bug rompe una regla de negocio
critica):
- RLS: profesional A pide la ficha de un paciente de profesional B ->
  404, no 403 (no filtrar que el paciente existe).
- Derivacion activa: profesional destino SI puede leer la ficha derivada;
  al desactivar la derivacion, vuelve a dar 404.
- EXCLUDE constraint: dos POST concurrentes a confirmar cita sobre el
  mismo espacio+horario -> uno 201, el otro 409, nunca los dos 201.
- Menor de edad: POST de cita para paciente <18 sin adulto_responsable
  registrado -> rechazo antes de tocar el insert.
- Practicante con `fecha_expiracion_acceso` vencida -> 401 en cualquier
  endpoint protegido.

## Fase 2: estres (k6), enfocado en el cuello de botella real

No es un test de throughput generico. El objetivo es el escenario que
motivo todo el diseño de agenda: reservas concurrentes sobre el mismo
box/horario. La metrica que importa no es peticiones por segundo, es
"exactamente una reserva confirmada, cero duplicados en `citas` al final".

Dos escenarios en el mismo archivo `stress-agenda.js`:
- Carga normal: VUs variados pegando a `/espacios/disponibilidad` y
  `/citas` en horarios distintos, para ver el comportamiento base.
- Colision deliberada: N VUs (10-50) intentando confirmar el MISMO
  espacio+horario al mismo tiempo, repetido varias veces durante la
  corrida.

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

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
      vus: 20,
      iterations: 1,
      startTime: '10s',
    },
  },
};

export function cargaNormal() {
  const res = http.get('http://localhost:3000/api/espacios/disponibilidad');
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}

export function colisionReserva() {
  // Mismo espacio_id y rango_horario para todos los VUs de este escenario,
  // a proposito: es la prueba de que el EXCLUDE constraint sostiene.
  const payload = JSON.stringify({ espacio_id: 1, inicio: '2026-11-01T10:00:00Z', fin: '2026-11-01T11:00:00Z' });
  const res = http.post('http://localhost:3000/api/citas/confirmar', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status 201 o 409, nunca otro': (r) => r.status === 201 || r.status === 409 });
}
```

Correr: `k6 run stress-agenda.js`. El reporte de k6 es secundario, la
prueba real es esta query despues de cada corrida, conectado como
`vinculos_owner` (con `app_user` la RLS de `citas` oculta filas ajenas y la
query no veria duplicados). El schema real guarda el rango en `inicio`/`fin`:
adaptar la query a `tstzrange(inicio, fin, '[)')`.

```sql
SELECT espacio_id, rango_horario, count(*)
FROM citas
WHERE estado = 'CONFIRMADA'
GROUP BY espacio_id, rango_horario
HAVING count(*) > 1;
```

Debe devolver cero filas. Si devuelve alguna, el constraint EXCLUDE no
esta bien definido y no se avanza a produccion hasta corregirlo.

## Fase 3: simulacion del entorno real (Docker Compose con limites)

Igualar los limites al plan de Lightsail de entrada real (512MB RAM /
1 vCPU para la API), no numeros arbitrarios: si un cuello de botella va a
aparecer, mejor ahora que con un cliente real.

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
      POSTGRES_DB: vinculos_stress
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M

  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://admin:password@db:5432/vinculos_stress
      - NODE_ENV=production
    depends_on:
      - db
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
```

## Flujo completo

1. `npm run test:integration`. Si pasa, build de la imagen.
2. `docker compose -f docker-compose.stress.yml up -d`.
3. En paralelo, `k6 run stress-agenda.js` apuntando al contenedor
   restringido.
4. Verificar dos cosas: la query de duplicados de la Fase 2 devuelve cero
   filas, y el contenedor `api` no se reinicio por falta de memoria
   (`docker compose logs api | grep -i oom`, o `docker ps` sin restarts).
   Solo si ambas se cumplen, el modulo de Agenda y Espacios se considera
   listo para el tenant de prueba.

## Restricciones que no se pueden dejar pendientes
- El test de colision sobre el EXCLUDE constraint es obligatorio, no
  opcional: valida la decision de arquitectura mas importante del
  proyecto, no una funcionalidad secundaria.
- k6 nunca corre contra la DB del tenant de prueba real ni contra
  produccion, siempre contra `docker-compose.stress.yml` con DB efimera.

## Salida esperada
- `test/jest-e2e.json` + los tests listados en la Fase 1.
- `stress-agenda.js`.
- `docker-compose.stress.yml`.
- `pruebas/README.md` corto con el flujo de 4 pasos y la query de
  verificacion de duplicados.
