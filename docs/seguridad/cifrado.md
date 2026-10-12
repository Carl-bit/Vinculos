# Cifrado de datos en reposo (envelope encryption)

Implementacion: `backend/src/common/crypto/` (`cifrado.ts`, `registro.ts`,
`contingencia.ts`, `cli-llaves.ts`). Operacion: `runbooks_llaves.md`.
Migracion: `20261009000000_cifrado_perfil_agenda_consentimiento`.

## Modelo

```
KEK (32 bytes, por silo)          Docker secret /run/secrets/vinculos_kek, solo servicio backend
 └─ envuelve ─> DEK por categoria  llaves_datos.dek_por_kek          (AES-256-GCM, AAD "dek:<id>")
                 └─ cifra ─> datos  columnas bytea de la app           (AES-256-GCM, AAD "tabla:columna:id")

Par de recuperacion (RSA-OAEP-4096, SHA-256)
 publica  -> config del servicio backend; envuelve cada DEK: llaves_datos.dek_por_recuperacion
 privada  -> nunca en un servidor; Shamir 2 de 3 entre proveedor, centro y sobre offline
```

- **La BD nunca ve una llave en claro** (no se usa pgcrypto). Solo guarda
  bytea opacos y DEKs envueltas.
- **Categorias de DEK**: IDENTIFICACION (RUT, telefonos, copias de autoria),
  CLINICO (notas, comentarios de supervision, motivo/detalle de derivacion),
  FINANCIERO (datos bancarios), HMAC (indices ciegos).
- **Formato de un valor**: `[1 formato][16 id DEK][4 version][12 IV][cifrado][16 tag]`.
  La cabecera tambien se autentica (va al AAD): cambiar la DEK o version que
  declara un valor hace fallar el descifrado. Largo minimo 49 bytes; la BD lo
  exige con CHECK (`*_cifrado`).
- **AAD = `tabla:columna:id_fila`**: un valor copiado a otra fila o columna no
  descifra. Por eso las filas con columnas cifradas no tienen DEFAULT de id: lo
  genera la API antes de cifrar.
- **Indice ciego**: `rut_hmac` = HMAC-SHA256 (DEK HMAC) del RUT normalizado
  (sin puntos, guion ni espacios; K mayuscula). UNIQUE en `pacientes` y
  `profesional_datos_privados`; indice simple en `adultos_responsables` (un
  adulto responde por varios pacientes). La DEK HMAC no rota de forma
  rutinaria (invalidaria todos los indices); ante compromiso se rota y un job
  recalcula los indices (runbook de compromiso).
- **Canarios**: cada version de DEK guarda un valor conocido cifrado con ella
  (`llaves_datos.canario`). La API los verifica al arrancar (y un job diario);
  un canario que no abre = llave rota o alterada -> la API no arranca.
- **Huella de la KEK**: HMAC de la KEK, guardada en `huella_kek`. Si la KEK
  montada no coincide, la API no arranca (falla cerrado).

`sesiones.token_hash` (02a) es bytea pero no es un cifrado: es el SHA-256 del
refresh token (los tests de "sin texto plano" y de registro la excluyen).

## Que se cifra y que no

Registro unico: `backend/src/common/crypto/registro.ts`. El runner de tests
compara ese registro con las columnas bytea reales de la BD.

| Se cifra | Por que |
|---|---|
| RUT de pacientes, adultos responsables y profesionales | Identificador nacional: con el se cruza cualquier otra base. |
| Telefonos (usuarios, pacientes, adultos responsables) | Contacto directo, permite ubicar a la persona. |
| Datos bancarios del profesional (banco, tipo y numero de cuenta, titular) | Financiero. |
| `evoluciones.notas`, `supervision_comentarios.texto`, `derivaciones.motivo`/`detalle` | Contenido clinico en texto libre. |
| `citas.enlace_online` | Da acceso a una sesion clinica en curso. `citas` conserva su DEFAULT de id: el enlace se genera con la cita ya creada. |
| Copia de autoria (`evoluciones.autor_*`) y emisor de boletas | Identifican al profesional en documentos de retencion legal. |
| `mensajes_paciente.contenido`, `solicitudes_epicrisis.motivo` (02g) | Texto libre del paciente: puede traer datos de salud. |
| `documentos_clinicos.contenido` (02h, CLINICO) | Archivo emitido por el tratante (epicrisis, receta...). Id generado por la API. |
| `envios_documento.enlace` (02h, CLINICO) | URL con el token de descarga, solo para el job de correo. Para validar la descarga se guarda aparte su SHA-256 (`token_hash`, texto). |
| `salas_videollamada.enlace` (02h, IDENTIFICACION) | Sala fija del profesional: da acceso a sus sesiones. Id de fila = `usuario_id`. |
| `notificaciones.asunto`, `notificaciones.cuerpo` (02i, CLINICO) | Mensaje armado con la plantilla (bandeja y correo): nombres, horario y enlaces de una atencion de salud. Lo escribe el job (cifrado por la API, AAD `notificaciones:<columna>:<id>`). |
| `recordatorios_cita.enlace` (02i, CLINICO) | URL con el token para confirmar o cancelar, solo para armar el mensaje. Para validar se guarda aparte su SHA-256 (`token_hash`). Id generado por la API. |
| `adjuntos_ficha.contenido` (02i, CLINICO) | Archivo externo de la ficha (informe, imagen) en base64. Id generado por la API. |

| No se cifra | Por que |
|---|---|
| `fecha_nacimiento` | La BD calcula la edad (menor de edad en citas y consentimientos). |
| Fechas, estados, modalidad, nivel de riesgo, tipo de sesion | La BD los usa en constraints (EXCLUDE de agenda, CHECKs), RLS y funciones. |
| Ids, catalogos (tipos de atencion, intervenciones, estados de avance) | Claves y datos sin personas. |
| `nombre` | Se ordena y se busca; sin RUT ni contacto, solo identifica dentro del centro. |
| `email` de login | Se busca en el login (`credenciales_login`); es la llave de acceso. |
| Montos, pagos, liquidaciones (02h) | La BD calcula saldos, sobrepago y liquidaciones con ellos. Lo sensible del cobro (datos bancarios, emisor de la boleta) si va cifrado. |
| `feeds_calendario.token_hash`, `envios_documento.token_hash` (02h), `recordatorios_cita.token_hash` (02i) | SHA-256 de un token aleatorio de 256 bits: no revela el token; se busca por igualdad. |
| Direcciones | Hoy no existen columnas de direccion; cuando se agreguen, van cifradas. |

## Modelo de amenazas

| Protege ante | No protege ante |
|---|---|
| Respaldo filtrado (dump, snapshot de Lightsail, volumen copiado): sin la KEK los datos sensibles son bytea opacos. | API comprometida (RCE): la API tiene la KEK en memoria y descifra todo lo que su usuario puede leer. |
| Acceso directo a la BD (credenciales de `app_user`, `vinculos_owner` o superusuario filtradas): ve filas, no el contenido cifrado. | Un usuario legitimo que abusa de su acceso (eso lo acotan RLS + auditoria `accesos_ficha`). |
| Un operador de base de datos curioso. | Perdida simultanea de la KEK **y** de 2 de las 3 partes de recuperacion: los datos cifrados se pierden (por diseño). |
| Copiar un valor cifrado a otra fila o columna (AAD). | Metadatos visibles: quien atiende a quien, fechas, estados, nombres. |

El texto libre no se seudonimiza: si alguien escribe un nombre o un RUT en
las notas, queda cifrado en reposo pero lo lee cualquiera que tenga acceso a
esa evolucion. La UI debe advertir que no se escriban datos identificatorios
en el texto libre.

## Retencion de 15 años

La ficha clinica se conserva al menos 15 años desde la ultima atencion
(Decreto 41, Ley 20.584). Consecuencias para las llaves:

- **Ninguna version de DEK con datos se destruye**: rotar crea una version
  nueva y retira la anterior (deja de cifrar, sigue descifrando). La BD lo
  impone: `llaves_datos` no admite DELETE ni cambios de DEK, version o
  canario, ni siquiera para el dueño.
- **Las DEK sobreviven a la KEK**: la envoltura de recuperacion permite
  re-envolverlas con una KEK nueva si la operacional se pierde o se
  compromete. La recuperacion no depende de AWS ni de ningun proveedor.
- **Simulacro trimestral** de recuperacion desde un respaldo con 2 partes
  (runbook): un procedimiento que no se practica no existe a los 15 años.
- Al cerrar la cuenta de un profesional sus datos personales se vacian, pero
  las copias de autoria cifradas en evoluciones y boletas se conservan
  (`retencion_datos.md`).

## Por que estas piezas

- **AES-256-GCM** (`node:crypto`): cifrado autenticado estandar, sin
  dependencias.
- **RSA-OAEP-4096 para recuperacion**: soportado nativamente por Node y por
  OpenSSL (se puede operar sin el codigo del proyecto en una emergencia).
  X25519 tambien sirve; se eligio RSA por esa portabilidad.
- **Shamir 2 de 3 con `shamir-secret-sharing`** (Privy): auditada por Cure53 y
  por Zellic, sin dependencias, TypeScript, GF(2^8) inspirado en el de
  HashiCorp Vault. 2 de 3 tolera la perdida de una parte y exige la
  colusion de dos custodios para reconstruir.
- **KEK como archivo (Docker secret), no variable de entorno**: las
  variables se filtran en `docker inspect`, volcados de proceso y logs.
- **Migracion a KMS**: solo cambia como se obtiene la KEK (se descifra con
  KMS al arrancar en vez de leer el secret). Las DEK, el formato y la
  recuperacion con Shamir no cambian.
