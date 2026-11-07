# Estadísticas de consultas por silo (pg_stat_statements)

Aprobado el 2026-11-06 (AUD-02). Sirve para medir, no para cobrar: cuántas
consultas hace cada endpoint (BD-01), cuáles son lentas, si conviene un
índice o Redis (CACHE-06) y qué plan necesita cada centro.

## Configuración

- `infra/docker-compose.yml`, servicio `db`: `shared_preload_libraries=pg_stat_statements`
  y `pg_stat_statements.track=top`.
- `infra/postgres/init/20-pg-stat-statements.sh`: crea la extensión al crear
  el volumen. En un silo ya creado (o en la BD local de desarrollo), después
  de `docker compose up -d db` con el compose nuevo:

  ```sh
  docker compose exec db sh /docker-entrypoint-initdb.d/20-pg-stat-statements.sh
  ```

## Privacidad

El texto se guarda normalizado (`WHERE rut_hmac = $1`): ningún valor de
paciente, RUT ni token. Lo consulta el operador como `POSTGRES_USER` dentro
del contenedor; no sale del silo ni va a herramientas de terceros.

## Consultas útiles

```sql
-- Las 15 que más tiempo consumen
SELECT calls, round(total_exec_time) AS ms_total, round(mean_exec_time, 2) AS ms_promedio, left(query, 120)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;

-- Consultas por petición de un endpoint: reiniciar, llamar una vez, contar
SELECT pg_stat_statements_reset();
-- (llamar al endpoint)
SELECT sum(calls) FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%';
```

Costo: unos pocos MB de memoria compartida (5.000 consultas distintas por
defecto) y un reinicio de Postgres al activarlo.
