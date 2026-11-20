# Pruebas de la API

## Manuales (sin Docker)

Guion por flujo y rol, preparacion del entorno (BD local con
`npm run bd:local -- iniciar`, datos demo con `npm run seed:demo` y
`npm run demo:reset`, correo en Mailpit) y usuarios demo:
`docs/pruebas/guion_manual.md`. Las requests manuales se hacen en Postman
(coleccion fuera del repo).

## Integracion (fase 1 de `prompts/04_pruebas.md`, sin Docker)

```sh
npm run test:e2e            # Jest + Supertest, BD efimera Postgres 18 local
npm run test:e2e -- 02d     # un archivo
```

`test/bd/levantar.sh` crea un cluster temporal (initdb), aplica las
migraciones como `vinculos_owner`, fija la contraseña de `app_user`, corre el
seed y aprovisiona llaves de prueba; la API de los tests se conecta solo como
`app_user`. `test/bd/bajar.sh` lo borra todo al terminar. Los casos de la fase
1 (RLS 404, derivacion, EXCLUDE concurrente, menor sin adulto, practicante
vencido) estan en `02c`, `02d`, `02f` y `02a`.

## Estres y capacidad (fases 2 y 3, con Docker)

Flujo (desde la raiz del repo, Git Bash; en PowerShell anteponer `sh`):

1. `npm run test:e2e` (en `backend/`) en verde.
2. `sh infra/stress/levantar.sh`: silo efimero `erp-stress` con el compose real
   y sus limites (db, backend: 256M y 1 vCPU), llaves por el runbook, seed
   demo, Mailpit propio. API en `http://127.0.0.1:3101/api`.
3. k6 en un contenedor en la red del silo (sin instalar k6):

   ```sh
   MSYS_NO_PATHCONV=1 docker run --rm --network erp-stress_borde \
     -v "$(pwd -W)/backend/pruebas:/scripts:ro" grafana/k6:0.54.0 run /scripts/stress-agenda.js
   ```

   Escenarios: `carga_normal` (10 VUs del equipo), `lectura_publica` (20 VUs,
   umbral p95 < 300 ms y 0 % de errores) y `colision_reserva` (30 VUs x 3
   rondas sobre el mismo profesional y horario: exactamente una 201 por ronda).
4. `sh infra/stress/verificar.sh`: la prueba real. Cero citas activas solapadas
   (por profesional y por box, como `vinculos_owner`) y ningun contenedor
   reiniciado ni muerto por memoria. Solo con ambas, Agenda queda lista.
5. `sh infra/stress/bajar.sh` borra el silo, sus volumenes y sus llaves.

Estres creciente (`stress-rampa.js`, 2026-11-20): etapas de 10, 25, 50, 100 y
200 VUs (2 min cada una), solo lecturas (7 de cada 10 VUs leen el sitio
publico, 3 del equipo leen agenda y ocupacion), asi que se puede repetir sin
hacer crecer la BD. Resumen propio por etapa (peticiones, p95, maximo, 5xx) y
punto de quiebre: la primera etapa con p95 > 300 ms o mas de 1 % de 5xx. Con
`-e SALIDA=/out/rampa.json` deja el resumen en JSON. En el servidor de pruebas
lo orquesta `scripts/mediciones/medir.sh rampa` del repo del plano de control.

Consulta de solapes (la corre `verificar.sh`; con `app_user` la RLS oculta
citas ajenas):

```sql
SELECT a.id, b.id FROM citas a JOIN citas b
  ON a.id < b.id AND a.profesional_id = b.profesional_id
 AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')
WHERE a.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA')
  AND b.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA');
-- y la misma por espacio_id con modalidad PRESENCIAL
```

Desde 03b la cita no lleva box: lo asigna la BD desde el bloque del
profesional. Por eso la colision se hace sobre el mismo profesional y horario.

Resultados de la corrida del 2026-11-07: `docs/operacion/resultados_04_pruebas.md`.
