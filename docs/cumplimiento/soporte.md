# Acceso de soporte del proveedor (AUD-01 E2.1, LEG-03)

Vinculos es **Encargado** del tratamiento: solo actua por instruccion del
centro (**Responsable**). El soporte **nunca ve datos personales ni
clinicos** (decision D5): ni nombres, ni contactos, ni RUT, ni fichas,
cifrados o no.

## Como funciona

| Pieza | Que hace |
|---|---|
| Autorizacion del centro | Un ADMIN la da en Configuracion > Soporte: motivo, alcance y plazo (1 a 72 horas). La puede revocar en cualquier momento. Tabla `autorizaciones_soporte` (append-only, solo se revoca). |
| Rol de BD `soporte_vinculos` | NOLOGIN, NOBYPASSRLS, sin GRANT sobre ninguna tabla. Solo puede ejecutar las funciones de diagnostico de abajo. |
| Funciones de diagnostico | Exigen una autorizacion vigente y dejan una fila en `registro_soporte` (funcion, rol de BD, fecha). El ADMIN ve el registro en la misma pantalla. Sin autorizacion responden 42501. |
| Registro | `registro_soporte`, append-only incluso para el dueño. |

### Alcances

| Alcance | Funciones |
|---|---|
| DIAGNOSTICO | `soporte_resumen()`: version de migraciones, usuarios activos por rol (conteo), citas de los proximos 7 dias por estado, notificaciones de los ultimos 7 dias por estado, correos de cuenta pendientes, alertas abiertas por tipo, ultima verificacion de llaves. `soporte_notificaciones_con_error(dias)`: tipo, canal, estado, intentos y error generico de envios fallidos (sin destinatario ni contenido). |
| CONFIGURACION | Lo anterior mas `soporte_configuracion()`: parametros del centro (`configuracion_centro` sin el RUT). |

## Procedimiento del operador

1. El centro abre la solicitud por su canal de soporte y su ADMIN otorga la
   autorizacion en el panel. Sin autorizacion no se hace nada.
2. El operador habilita el login del rol solo hasta el fin de la
   autorizacion, con una contraseña de un solo uso (guardar fuera de git):

   ```sql
   ALTER ROLE soporte_vinculos LOGIN PASSWORD '<aleatoria>' VALID UNTIL '<hasta de la autorizacion>';
   ```

   Se corre como dueño en el contenedor `migrate` del silo y se registra con
   `infra/scripts/llaves/registrar.sh` (tipo VERIFICACION, detalle "login
   soporte habilitado hasta ...").
3. Diagnostico, conectado como `soporte_vinculos`:

   ```sql
   SELECT soporte_resumen();
   SELECT * FROM soporte_notificaciones_con_error(7);
   SELECT soporte_configuracion();  -- solo con alcance CONFIGURACION
   ```

4. Al terminar (o al vencer), deshabilitar el login:

   ```sql
   ALTER ROLE soporte_vinculos NOLOGIN PASSWORD NULL;
   ```

## Si el problema exige tocar datos

El soporte no lo hace. Opciones, en orden:

1. El centro lo corrige desde el panel (ADMIN o GESTION), guiado por el
   soporte por un canal externo, sin compartir pantalla con datos de
   pacientes.
2. Si la correccion no existe en el panel, se programa como cambio de
   producto (migracion o funcion nueva), revisado y probado como cualquier
   otro, y se aplica con el procedimiento de despliegue.

## Credenciales de dueño (`OWNER_DB_PASSWORD`)

Solo para mantencion: aplicar migraciones (`migrate`), operaciones de llaves
(`infra/scripts/llaves/`, cada una en `eventos_llaves`) y respaldos. Nunca
para consultar datos de un centro. Toda conexion como dueño fuera de esos
casos es un incidente (`docs/cumplimiento/incidentes.md`).

## Pendiente

- Llevar el registro de habilitacion del login (paso 2) a una tabla propia
  en vez de `eventos_llaves`, si el volumen de soporte lo justifica.
- Panel maestro (post-MVP): solicitudes de soporte centralizadas, sin datos
  de los silos.
