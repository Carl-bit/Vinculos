# Sesion unica y registro de conexiones (2026-11-07)

Documento del proceso completo. Origen: el diseño de Mi cuenta > Seguridad
mostraba "Sesiones abiertas" con "Cerrar sesion" por dispositivo, y la API no
exponia sesiones.

## 1. Decision del usuario

- Por ahora el producto es solo web. **Una sola sesion por usuario**: no se
  manejan varias sesiones abiertas a la vez ("familias" de tokens por
  dispositivo), asi que no hay "Cerrar sesion" por dispositivo.
- **Se registran las conexiones** para tener trazabilidad y seguridad, y el
  integrante del equipo las ve en sus datos personales (Mi cuenta >
  Seguridad).
- Sin ciudad: mostrarla exige guardar la IP (dato personal) y usar un
  servicio de geolocalizacion. Se guarda solo el resumen del navegador y el
  sistema ("Chrome en Windows").

## 2. Como funcionaba antes

- `sesiones` (02a) guarda solo el SHA-256 de cada refresh token. Cada login
  abre una familia; cada refresh rota el token dentro de la familia; reusar
  un token usado revoca la familia (posible robo).
- Un usuario podia tener varias familias abiertas (varios navegadores).
- El access token (JWT, `JWT_ACCESO_MINUTOS` = 15) no se revocaba: una
  sesion cerrada seguia sirviendo hasta que el JWT vencia.

## 3. Como funciona ahora

1. **Login** (contraseña + segundo factor, enlace de acceso o activacion):
   `crear_sesion` toma un candado por usuario (`pg_advisory_xact_lock`),
   revoca toda sesion abierta del usuario con motivo `NUEVA_SESION` y abre
   la familia nueva con el `dispositivo`. El candado evita que dos logins
   simultaneos queden ambos abiertos.
2. **Access token**: lleva `sid` = familia de la sesion.
3. **Cada request**: el RlsInterceptor, en la misma consulta que
   `acceso_vigente()`, evalua `sesion_vigente(sid)`. Si la sesion se cerro
   (otro login, logout, cambio de contraseña o de rol, baja), la request da
   401 **aunque el JWT no haya vencido**. Un JWT sin `sid` (emitido antes del
   cambio) tambien da 401. Costo: una busqueda por indice
   (`sesiones_familia_id_idx`) dentro de una consulta que ya existia.
4. **Refresh** fallido: la API consulta `motivo_fin_sesion(token)`; si fue
   `NUEVA_SESION`, responde 401 con `motivo: "NUEVA_SESION"` y el front lleva
   al login con el aviso "se ingreso con tu cuenta en otro navegador o
   dispositivo; si no fuiste tu, cambia tu contraseña".
5. **Cambio de rol** (cuentas con dos roles): sigue abriendo una familia
   nueva (la conexion anterior queda con motivo `CAMBIO_ROL`).
6. **Pestañas del mismo navegador**: comparten la cookie, es la misma sesion.

## 4. Registro de conexiones

No hay tabla nueva: una conexion = una familia de `sesiones`, que ya guarda
inicio, rotaciones, revocacion y motivo. `mis_conexiones(limite)` (SECURITY
DEFINER, solo el usuario del contexto) devuelve por familia:

| Campo | De donde sale |
|---|---|
| `rol`, `dispositivo` | primer token de la familia |
| `inicio` | creacion del primer token |
| `ultimaActividad` | ultima rotacion (el front renueva cada ~14 min mientras hay actividad) |
| `activa` | hay un token sin usar, sin revocar y sin vencer |
| `fin`, `motivo` | revocacion (LOGOUT, NUEVA_SESION, CAMBIO_ROL, CAMBIO_CUENTA, REUTILIZACION, NO_VIGENTE) o, si nadie la revoco, vencimiento por inactividad (INACTIVIDAD, fin = vencimiento del ultimo token) |

`GET /api/usuarios/yo/conexiones` (ADMIN, GESTION, PROFESIONAL, PRACTICANTE)
devuelve las ultimas 30 y marca `actual` comparando la familia con el `sid`
de la request. PACIENTE y RESPONSABLE: 403 (no se pidio en el portal).

## 5. Capas tocadas

- **BD**: migracion `20261107000100_sesion_unica_conexiones`: columna
  `sesiones.dispositivo` (CHECK hasta 80), `crear_sesion` (5º parametro
  opcional), `rotar_sesion` y `cambiar_rol_sesion` (devuelven la familia y
  copian el dispositivo), `sesion_vigente`, `motivo_fin_sesion`,
  `mis_conexiones`. `sesiones` sigue sin GRANT directo.
- **API**: `core/auth/dispositivo.ts` (resumen del User-Agent; nunca se
  guarda completo), `auth.controller.ts` (lee `User-Agent`),
  `auth.service.ts` (`sid` en el JWT, motivo en el refresh), `guards.ts`
  (exige `sid`), `contexto-bd.service.ts` (`sesion_vigente` por request),
  `nucleo` (`GET usuarios/yo/conexiones`, `ConexionVista`).
- **Front**: `app/sesion/[accion]/route.ts` reenvia el `User-Agent` a la API
  (el login pasa por el puente de sesion); `lib/sesion.ts` (motivos
  `otro-ingreso` y `clave-cambiada`); `GuardaZona` y `FormularioIngreso`
  (avisos en el login); `shared/ConexionesCuenta.tsx` (nuevo, en Mi cuenta >
  Seguridad: "Esta sesion" y el historial con el motivo de cada cierre);
  `shared/CambioPassword.tsx`.
- **Seed demo**: entra varias veces con la misma cuenta (otro rol, otro
  paso); ahora cada token recuerda su cuenta y ante un 401 vuelve a entrar.
- **Tests de integracion**: el helper `login` olvida el token guardado de
  esa cuenta (el login lo invalida).

## 6. Cambios de comportamiento visibles

- Entrar en otro navegador cierra el anterior **de inmediato** (en su
  siguiente accion vuelve al login con el aviso).
- **Cambiar la contraseña** ya cerraba todas las sesiones en la BD (trigger
  de 02a), pero la actual seguia viva hasta 15 minutos. Ahora se corta al
  instante: la pantalla cierra la sesion y el login dice "Tu contraseña
  cambio y cerramos tus sesiones. Ingresa con la contraseña nueva."
- Cerrar sesion invalida tambien el access token.

## 7. Pruebas

- `seguridad_bd.sql` caso 160: login nuevo cierra el anterior
  (`NUEVA_SESION`), la sesion anterior no renueva, la rotacion conserva la
  familia, `sesion_vigente` solo para la familia propia y abierta,
  `mis_conexiones` solo propias y con contexto, limite, logout. Casos 86 y
  101 adaptados a las firmas nuevas.
- Unitario `core/auth/dispositivo.spec.ts`.
- Integracion `test/sesion-respaldos.e2e-spec.ts`: dos navegadores, 401
  inmediato del token anterior, `motivo` en el refresh, historial con
  dispositivos y motivos, logout, 403 para paciente, JWT sin `sid`.

## 8. Limites y pendientes

- `sesiones` no se purga: el historial crece con cada rotacion (~4 filas por
  hora de uso). Si pesa, un job que borre familias cerradas hace mas de N
  meses (y documentar el plazo en `retencion_datos.md`).
- El ADMIN no ve las conexiones de otros integrantes (no se pidio).
- Sin IP: no se puede distinguir dos ingresos desde el mismo tipo de
  navegador en lugares distintos. Agregarla es una decision de privacidad
  (dato personal, Ley 21.719).
- Cuando exista app movil, la regla "una sesion por usuario" debera
  revisarse (por ejemplo, una por canal).
