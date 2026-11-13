# Continuidad: respaldos, restauracion, monitoreo y deteccion (AUD-01 E2.4)

Cubre CENS-S5 (disponibilidad), CENS-S1 (respaldos cifrados) y BRE-03
(deteccion). Objetivos de la seccion 1 **aprobados el 2026-10-28**.

## 1. Objetivos (aprobados)

| Objetivo | Valor | Como se cumple |
|---|---|---|
| RPO (datos que se pueden perder) | 24 horas | Respaldo diario a las 02:00 de Chile |
| RTO (tiempo para volver a operar) | 4 horas habiles | Restaurar el ultimo respaldo en un silo nuevo con el procedimiento de la seccion 3 |
| Retencion de respaldos | 7 dias en el host, 35 dias en el destino externo | `RETENCION_LOCAL_DIAS` y regla de ciclo de vida del bucket |
| Prueba de restauracion | Mensual, por silo | Seccion 3, registrada en `eventos_llaves` (RESTAURACION) |

## 2. Respaldo diario cifrado

`infra/scripts/continuidad/respaldar.sh`:

1. `pg_dump -Fc` dentro del contenedor `db` del silo.
2. Cifrado AES-256 (openssl, PBKDF2) con `infra/secrets/<slug>/respaldo.key`,
   distinta de la KEK. Un respaldo filtrado no se abre sin esa llave, y aun
   abierto, las columnas sensibles siguen cifradas con la KEK (`cifrado.md`).
3. Copia al destino externo `DESTINO_RESPALDO` (un prefijo por silo; nunca se
   mezclan centros) y `sha256` del archivo.
4. Borra los locales mas antiguos que `RETENCION_LOCAL_DIAS`.

Puesta en marcha por silo (en su servidor, una vez): crea la llave de
respaldo si falta y agrega al crontab el respaldo diario, el monitor de
salud y el recordatorio de la prueba mensual, sin duplicar lineas.

```sh
CLIENTE_SLUG=<slug> DOMINIO=<dominio> DESTINO_RESPALDO=s3://<bucket>/<slug>/ \
ALERTA_URL=<webhook> MAILTO=<correo del operador> sh infra/scripts/continuidad/instalar.sh
```

La llave `respaldo.key` se custodia como la KEK (`runbooks_llaves.md`): una
copia fuera del host.

## 3. Restauracion y prueba mensual

```sh
CLIENTE_SLUG=<slug> sh infra/scripts/continuidad/descifrar_respaldo.sh <archivo>.dump.enc /tmp/r.dump
CLIENTE_SLUG=<slug> MODO=docker sh infra/scripts/llaves/verificar_respaldo.sh /tmp/r.dump kek
shred -u /tmp/r.dump
CLIENTE_SLUG=<slug> MODO=docker sh infra/scripts/llaves/registrar.sh RESTAURACION "prueba mensual <fecha>"
```

`verificar_respaldo.sh` restaura en un Postgres temporal y comprueba que las
llaves descifran los canarios. Para volver a operar (RTO), el mismo archivo
se restaura en el `db` de un silo nuevo antes de `docker compose up`.

## 4. Monitoreo

`infra/scripts/continuidad/salud.sh` consulta `/api/salud` (BD y canarios de
cifrado) y, si falla dos veces seguidas, avisa al operador (`ALERTA_URL` y
correo de cron). El aviso no lleva datos de pacientes.

```sh
*/5 * * * * DOMINIO=<dominio> ALERTA_URL=<webhook> sh /ruta/repo/infra/scripts/continuidad/salud.sh
MAILTO=<correo del operador>
```

Si se usa un servicio externo de monitoreo, solo ve la URL de salud (sin
datos personales) y debe anotarse en `subencargados.md`.

## 5. Deteccion de accesos indebidos (BRE-03)

| Señal | Donde | Que hace |
|---|---|---|
| Una cuenta accede a datos de mas de 40 pacientes distintos en una hora | job `detectar_anomalias` (cada hora) sobre `accesos_ficha` | Alerta interna ACCESO_ANOMALO para ADMIN (sin nombres); se revisa en Configuracion > Auditoria de accesos |
| 10 o mas ingresos fallidos con un mismo correo o RUT en una hora | `intentos_login_fallidos` (solo HMAC del identificador) + el mismo job | Alerta interna LOGIN_FALLIDO_REPETIDO |
| Canario de cifrado falla | job `verificar_canarios` (diario) | Alerta FALLO_CANARIO; `/api/salud` falla y avisa `salud.sh` |
| Diagnostico del soporte | `registro_soporte` | Visible para ADMIN en Configuracion > Soporte |

Una alerta de deteccion confirmada se trata como incidente
(`incidentes.md`).

## 6. Feriados de cada año

El plazo de las solicitudes de derechos usa `feriados`. Los nacionales que
la ley fija con una regla los calcula la BD (`feriados_legales`) y el job
`generar_feriados` los carga cada dia para este año y el siguiente. Los que
crea una ley puntual o los regionales los agrega el ADMIN en Configuracion >
Feriados (tambien puede quitar uno). No hay carga manual por año.

## Pendiente (requiere el servidor o cuentas externas)

- Correr `instalar.sh` en el servidor de cada silo (hoy no hay servidor de
  produccion).
- Crear el bucket de respaldos (cifrado del lado del servidor, bloqueo de
  borrado, ciclo de vida 35 dias) y anotar region en `subencargados.md`.
- Cifrado del disco del servidor (Lightsail) documentado al desplegar.
