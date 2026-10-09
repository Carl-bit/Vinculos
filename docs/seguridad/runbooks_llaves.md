# Runbooks de llaves

Scripts: `infra/scripts/llaves/` (comun.sh documenta las variables). En un
silo se corren en el host con `MODO=docker` (la CLI corre dentro del
servicio `migrate`, el unico con credenciales de dueño). Cada operacion queda
en `eventos_llaves` (append-only). Modelo y razones: `cifrado.md`.

```
CLIENTE_SLUG=<silo> MODO=docker ACTOR="<nombre operador>" sh infra/scripts/llaves/<script>.sh ...
```

Archivos del silo (fuera de git, `chmod 700`): `infra/secrets/<slug>/kek`,
`recuperacion.pub`. Las partes nunca se quedan en el host.

**Reglas que no se rompen**
- Nada genera llaves automaticamente: solo estos scripts, a mano.
- Ninguna version con datos se destruye. Rotar = version nueva + retirar.
- Ningun script sobrescribe una llave: si el archivo existe, se detiene.
- La privada de recuperacion nunca se escribe en disco; solo sus partes.
- Ninguna llave de desarrollo (`infra/secrets/dev`) se usa en otro entorno.

**Quien es el "ADMIN de plataforma"**: el operador del proveedor (quien
administra el host y tiene `OWNER_DB_PASSWORD` del silo). Es el unico que
corre estos scripts y el unico que lee `custodios_llave` y `eventos_llaves`
(no hay GRANT para `app_user`; ningun rol del centro los ve).

---

## 1. Aprovisionamiento (silo nuevo, una vez)

1. `docker compose up -d db migrate` (crea `llaves_datos` y demas tablas).
2. Definir custodios: `CUSTODIOS="Proveedor:operador,Centro:direccion,Sobre offline:caja fuerte"`.
3. `sh infra/scripts/llaves/aprovisionar.sh` -> KEK, `recuperacion.pub`, 4
   DEK v1 con canario, 3 partes en `partes_entregar/`, filas en
   `custodios_llave`, evento APROVISIONAMIENTO. Verifica que cada par de
   partes reconstruye la privada antes de escribir nada.
4. Entregar cada parte por un canal distinto (parte 1 al proveedor, parte 2
   al centro, parte 3 en sobre sellado a caja fuerte). Borrar
   `partes_entregar/` (`shred -u`).
5. `docker compose up -d` (la API arranca solo si la huella y los canarios
   coinciden).
6. Respaldar la BD y correr el paso 6 (restauracion) con KEK y con 2 partes.

## 2. Rotacion de DEK (anual, o si se sospecha de una DEK)

1. `sh rotar.sh crear` -> version nueva inactiva de IDENTIFICACION, CLINICO
   y FINANCIERO (HMAC no rota). Se niega si hay otra rotacion pendiente.
2. Respaldar la BD (las DEK nuevas ya estan en el respaldo).
3. `verificar_respaldo.sh RESPALDO kek` y `... recuperacion PARTE PARTE`.
4. `sh rotar.sh activar` -> verifica KEK + canario + envoltura de
   recuperacion y activa; la anterior queda retirada (sigue descifrando).
5. Reiniciar la API. Los datos nuevos usan la version nueva; los viejos se
   leen con la suya. Re-cifrar datos viejos es opcional y lo hace la API.

## 3. Rotacion planificada de la KEK

1. `sh rotar.sh kek` -> KEK nueva escrita primero en disco, luego re-envuelve
   todas las DEK; reemplaza `kek` y guarda `kek.anterior-<fecha>`.
2. Reiniciar la API (monta el secret nuevo). Verificar que arranca.
3. Respaldar y verificar el respaldo con la KEK nueva. Destruir
   `kek.anterior-*` (`shred -u`).

## 4. Perdida de la KEK

Sintoma: la API no arranca ("La KEK montada no corresponde" o archivo
ausente). Los datos estan intactos.

1. Reunir 2 de los 3 custodios. Copiar sus partes al host solo durante la
   operacion.
2. `sh recuperar.sh PARTE_A PARTE_B` -> reconstruye la privada en memoria,
   abre cada DEK con su envoltura de recuperacion, verifica canarios, genera
   KEK nueva y re-envuelve. Las partes copiadas se borran al terminar.
3. Reiniciar la API. Registrar quienes participaron:
   `sh registrar.sh RESTAURACION "custodios: ..."`.
4. Las partes siguen siendo validas (la privada no cambio). Si se expusieron
   durante la operacion, seguir con el paso 5.

## 5. Compromiso (KEK, DEK o parte filtrada)

1. Registrar el evento: `sh registrar.sh COMPROMISO "<que y cuando>"`.
2. **KEK comprometida**: `rotar.sh kek` (o `recuperar.sh` si ademas se perdio).
3. **Parte comprometida o custodio que se va**: paso 6 (cambio de custodios).
4. **DEK comprometida** (o el host completo): `rotar.sh kek` + `rotar.sh
   crear/activar` + re-cifrado de los datos por la API. Las versiones viejas
   no se destruyen (retencion), pero quedan solo para leer.
5. **DEK HMAC comprometida** (permite probar RUTs contra los indices ciegos).
   La llave HMAC no rota de forma rutinaria, pero ante compromiso:
   1. Ventana de mantencion: la API deja de aceptar altas y busquedas por RUT
      (durante el recalculo los indices viejos y nuevos no coinciden).
   2. `sh rotar.sh hmac-compromiso` (version HMAC nueva, inactiva) y
      `sh rotar.sh activar`. Reiniciar la API.
   3. Job de la API (02): descifra cada RUT (`pacientes`,
      `adultos_responsables`, `profesional_datos_privados`) con su AAD y
      recalcula `rut_hmac` con la HMAC nueva, en lotes y en transacciones. Un
      23505 durante el recalculo es un RUT duplicado real: se resuelve a mano.
   4. Verificar que el conteo del job = filas con RUT y cerrar la ventana.
   5. La version HMAC anterior queda retirada (no se destruye).
6. Evaluar notificacion a pacientes y autoridad segun la ley vigente.

## 6. Cambio de custodio

Shamir no revoca partes: un custodio saliente conserva la suya. Por eso el
cambio es un par de recuperacion nuevo.

1. `CUSTODIOS="..." sh rotar.sh custodios` -> par nuevo, todas las DEK
   re-envueltas con la publica nueva (se abren con la KEK), 3 partes nuevas en
   `partes_entregar_<fecha>/`, custodios anteriores cerrados en
   `custodios_llave`, evento CAMBIO_CUSTODIO.
2. Entregar las partes nuevas; pedir a los custodios que destruyan las
   anteriores (ya no abren nada).
3. Respaldar y verificar por recuperacion con 2 partes nuevas.

## 7. Restauracion mensual (prueba de respaldo)

`sh verificar_respaldo.sh RESPALDO.dump kek`: restaura en un Postgres 18
temporal (contenedor desechable) y lee los canarios de todas las versiones.
Registrar el resultado: `sh registrar.sh VERIFICACION "<respaldo y resultado>"`.

## 8. Simulacro trimestral (recuperacion)

Con 2 custodios distintos cada vez:
`sh verificar_respaldo.sh RESPALDO.dump recuperacion PARTE_A PARTE_B`.
Prueba que, sin la KEK, el respaldo se puede abrir. Registrar con
`sh registrar.sh SIMULACRO "<custodios que participaron>"`. Si falla: tratarlo como
incidente (paso 5) antes de que se necesite de verdad.

## 9. Migracion a KMS (AWS)

Solo cambia como obtiene la API la KEK: en vez de leer
`/run/secrets/vinculos_kek`, descifra al arrancar una KEK envuelta por KMS.
La huella, las DEK, el formato y la recuperacion con Shamir no cambian, y la
recuperacion sigue sin depender de AWS (si se pierde el acceso a KMS, el paso
4 genera una KEK nueva desde las partes).

## Desarrollo

`infra/scripts/reset_dev.sh` borra `infra/secrets/dev` y aprovisiona llaves
nuevas despues del seed. La API local usa `KEK_PATH=../infra/secrets/dev/kek`.
Las partes de dev quedan en `infra/secrets/dev/partes_entregar/` (no se
entregan a nadie).
