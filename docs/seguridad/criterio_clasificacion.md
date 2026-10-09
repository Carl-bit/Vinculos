# Criterio de clasificacion de tablas

Toda tabla de la BD del silo declara una categoria. La categoria decide el
patron de seguridad; la matriz (`matriz_permisos.md`) la registra por tabla y
`backend/prisma/tests/seguridad_bd.sql` la prueba por rol.

Base comun a las tres: ENABLE + FORCE RLS, politica RESTRICTIVE
`<tabla>_acceso_vigente` y GRANT minimo a `app_user`. Sin contexto
(`app.current_usuario_id` / `app.current_rol`) toda tabla devuelve 0 filas.

| Categoria | Que contiene | Patron | Ejemplos |
|---|---|---|---|
| **A** | Datos personales o sensibles (salud, contacto, dinero, vinculos laborales, llaves). | RLS por rol: cada rol ve y escribe solo las filas que le corresponden. Escritura con reglas de estado: sin GRANT directo, solo funciones `SECURITY DEFINER`. | `pacientes`, `evoluciones`, `pagos`, `boletas`, `consentimientos`, `supervisiones`, `profesional_datos_privados`, `tarifas`, `llaves_datos`, `avisos_consentimiento`, `revisiones_retencion`, `consultas_retencion` |
| **B** | Catalogos sin datos personales. | RLS con lectura abierta a todo autenticado (`USING (true)` + acceso vigente) y escritura restringida por politica a ADMIN (o ADMIN/GESTION). Nunca DELETE si otras tablas lo referencian: se desactiva. | `tipos_atencion`, `espacios`, `profesional_tipos_atencion`, `intervenciones`, `estados_avance`, `tipos_sesion` |
| **C** | "Saber que existe, no de quien": otros roles necesitan un dato derivado sin ver la fila. | RLS estricta sobre la tabla + funcion `SECURITY DEFINER` que entrega lo minimo (columnas fijas, sin identificadores) y valida rol dentro. | `citas` / `bloqueos_temporales` -> `ocupacion_espacios()`; `usuarios` / `profesionales` -> `directorio_interno()`, `perfiles_publicos()`; `pacientes` -> `supervision_casos()`; `disponibilidad_profesional` / `bloqueos_agenda` -> `disponibilidad_publica()`; `derivaciones` -> `derivaciones_pendientes()` |

Una tabla puede ser **A+C**: la fila completa es A y ademas existe una
funcion C para lo que otros roles necesitan (`profesionales`,
`bloqueos_temporales`, `usuarios`).

## Como decidir

1. ¿La fila identifica o describe a una persona (paciente, profesional,
   practicante) o su dinero? -> **A**.
2. ¿Otro rol necesita saber algo de esa fila (que esta ocupado, quien es mi
   supervisor, que perfiles son publicos) sin ver el resto? -> agregar **C**
   (funcion), nunca abrir la politica.
3. ¿Es una lista de valores del centro sin personas? -> **B**.

Tablas sin ningun GRANT para `app_user` (`llaves_datos`, `custodios_llave`,
`eventos_llaves`) siguen siendo A con ENABLE + FORCE RLS y sin politicas; la
API solo usa sus funciones (`llaves_vigentes()`, `registrar_evento_llaves()`).

## Cifrado (ortogonal a la categoria)

La categoria decide quien ve la fila; el cifrado protege la columna en reposo
(respaldo filtrado, acceso directo a la BD). Toda columna nueva con un
identificador (RUT), contacto (telefono, direccion), dato bancario o texto
clinico libre va cifrada: `bytea` + CHECK de largo minimo + fila en
`backend/src/common/crypto/registro.ts` (el runner de tests compara ambos).
Ver `cifrado.md`.

## Reglas para las funciones C

- `SECURITY DEFINER` + `SET search_path = public, pg_temp`.
- Validan `acceso_vigente()` y rol dentro (salvo `perfiles_publicos()` y
  `credenciales_login()`, pensadas para no autenticados).
- Columnas de salida fijas; un test compara `proargnames` para que agregar una
  columna sea una decision visible.
- EXECUTE revocado a PUBLIC y otorgado solo a `app_user`.
- Si exponen datos clinicos (supervision), registran en `accesos_ficha`.

## Limites conocidos

- El texto libre (evoluciones, motivo/detalle de derivacion, comentarios de
  supervision) no se seudonimiza: si alguien escribe un nombre o un dato
  identificatorio, quien tenga acceso a ese texto lo lee. La seudonimizacion
  de `supervision_casos()` cubre solo las columnas estructuradas.
