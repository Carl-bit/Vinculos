# Pruebas manuales con Postman

Coleccion: `vinculos.postman_collection.json`. Contiene unas 100 requests en
9 carpetas, con tests de status y variables que se encadenan solas (tokens,
ids y fechas de la cita).

## 1. Levantar (una vez)

Requisitos: Docker Desktop, Node 20+ y Git Bash (los scripts son `sh`).

```bash
# Postgres nativo de Windows ocupa el 5432 y choca con el contenedor.
# PowerShell como administrador:  Stop-Service postgresql-x64-18

# Desde la raiz del repo, en Git Bash:
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env
# OWNER_DB_PASSWORD y APP_DB_PASSWORD deben coincidir con las de
# MIGRATION_DATABASE_URL, DATABASE_URL y APP_DB_PASSWORD de backend/.env.
(cd backend && npm install)
sh infra/scripts/reset_dev.sh        # BORRA la BD de dev: migra, seed y llaves

cd backend
npm run start:dev                    # http://localhost:3001/api
```

Comprobacion: `curl http://localhost:3001/api/salud` responde 200.

Para volver a un estado limpio, ejecutar `sh infra/scripts/reset_dev.sh` otra
vez. Despues hay que repetir la carpeta 00 en Postman, porque los ids cambian.

## 2. Importar en Postman

1. Ir a Import y elegir `backend/pruebas/postman/vinculos.postman_collection.json`.
2. Las variables estan en la coleccion (pestaña Variables). `baseUrl` vale
   `http://localhost:3001/api` y `password` vale `dev-password`, la del seed.
3. No hace falta configurar un Environment.

## 3. Orden de ejecucion

Correr la coleccion completa en el Collection Runner, o carpeta por carpeta en
orden. Las carpetas dependen de las anteriores, porque guardan ids en variables.

| Carpeta | Que corrobora |
|---|---|
| 00 Salud y login | API viva; login de los 4 usuarios del seed; refresh rotativo |
| 01 Nucleo | `usuarios/yo` por rol, configuracion, directorio interno, alta de usuario |
| 02 Equipo | perfil, tipos de atencion, tarifa, datos bancarios cifrados |
| 03 Pacientes y fichas | paciente, menor de edad, apertura de ficha, evoluciones append-only (la correccion es una fila nueva) |
| 04 Agenda | espacio, disponibilidad, huecos, verificacion, crear y reprogramar cita |
| 05 Cobros | pago y anulacion, arriendos, liquidaciones, vista del paciente |
| 06 Derivaciones | derivar de PROF 1 a PROF 2, oferta, aceptacion, consentimientos |
| 07 Portal y match | match publico sin login, portal del paciente, mensajes, epicrisis, notificaciones |
| 08 Corroboracion | reglas que **deben fallar**: 401, 403 por rol, 404 por RLS, 409 por EXCLUDE, 422 por menor sin adulto, 400 por DTO |

Los usuarios del seed son:
- `admin@centro-prueba.cl`
- `profesional1@centro-prueba.cl`
- `profesional2@centro-prueba.cl`
- `paciente@centro-prueba.cl`, vinculado a Profesional Uno.

Notas:
- Los tokens duran 15 minutos. Si algo da 401, repetir la carpeta 00.
- El login permite 10 intentos por minuto por IP. Si se repite mucho, da 429.
- La cita se agenda en el proximo dia habil, 7 dias despues, a las 15:00Z.
  El script pre-request de la coleccion calcula la fecha.
- Algunas requests aceptan mas de un status, por ejemplo 409 cuando el recurso
  ya existe en una segunda corrida. Si un test falla, leer el `message` de la
  respuesta: casi siempre nombra la regla o constraint de la BD.

## 4. Mirar la BD

Conexion en DBeaver, pgAdmin o `psql`: host `localhost`, puerto `5432`, BD `app`.

- `vinculos_owner` (password `OWNER_DB_PASSWORD`): **se salta RLS** y ve todo.
  Sirve para inspeccionar, no para validar permisos.
- `app_user` (password `APP_DB_PASSWORD`): ve solo lo que permite el contexto.

```sql
-- Lo que ve un rol (como app_user). Ids: SELECT id, email, rol FROM usuarios; (como owner)
BEGIN;
SELECT set_config('app.current_usuario_id', '<uuid profesional2>', true),
       set_config('app.current_rol', 'PROFESIONAL', true);
SELECT id, nombre FROM pacientes;     -- no debe incluir pacientes de PROF 1
ROLLBACK;

-- Sin contexto, app_user no debe ver nada (o recibe un error de RLS):
SELECT count(*) FROM pacientes;

-- Cifrado: rut y telefono en bytea, nunca texto plano (como owner)
SELECT rut, telefono FROM pacientes LIMIT 3;

-- Auditoria de acceso a fichas (despues de "Ver ficha")
SELECT * FROM accesos_ficha ORDER BY 1 DESC LIMIT 5;

-- Prueba real de agenda: no debe haber solapamientos
SELECT a.id, b.id FROM citas a JOIN citas b
  ON a.id < b.id AND a.espacio_id = b.espacio_id
 AND a.estado <> 'CANCELADA' AND b.estado <> 'CANCELADA'
 AND tstzrange(a.inicio, a.fin) && tstzrange(b.inicio, b.fin);
```

Si una columna o tabla tiene otro nombre, revisar `backend/prisma/schema.prisma`
(`@@map` y `@map`).

## 5. Tests automaticos (complementan Postman)

```bash
cd backend
npm test                               # unitarios
npm run test:e2e                       # integracion por rol
sh prisma/tests/correr_tests_bd.sh     # RLS y constraints en un cluster temporal
```
