# Pruebas de la API

## Integracion (sin Docker)

```sh
npm run test:e2e            # Jest + Supertest, BD efimera Postgres 18 local
npm run test:e2e -- 02d     # un archivo
```

`test/bd/levantar.sh` crea un cluster temporal (initdb), aplica las
migraciones como `vinculos_owner`, fija la contraseña de `app_user`, corre el
seed y aprovisiona llaves de prueba; la API de los tests se conecta solo como
`app_user`. `test/bd/bajar.sh` lo borra todo al terminar.

## Estres de agenda (k6) — preparado, pendiente de Docker

`stress-agenda.js` (escenarios de `prompts/04_pruebas.md`). Se corre solo
contra `docker-compose.stress.yml` (fase 3 de 04, aun no creado) con BD
efimera:

```sh
k6 run -e API_URL=http://localhost:3001/api -e EMAIL=... -e PASSWORD=... \
  -e ESPACIO_ID=... -e PROFESIONALES=id1,id2 -e PACIENTES=p1,p2 -e DIA=2026-12-01 \
  pruebas/stress-agenda.js
```

La prueba real es esta query despues de la corrida, como `vinculos_owner`
(con `app_user` la RLS oculta citas ajenas). Debe devolver cero filas:

```sql
SELECT a.id, b.id
FROM citas a JOIN citas b
  ON a.id < b.id AND a.espacio_id = b.espacio_id
 AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')
WHERE a.estado = 'CONFIRMADA' AND b.estado = 'CONFIRMADA';
```

El test de integracion `test/02d-agenda.e2e-spec.ts` ("concurrencia") ya
corre la misma verificacion con 5 rondas de 8 reservas simultaneas.
