# Contrato del centro con Vinculos (AUD-01 E2.2, LEG-06)

Términos de servicio y anexo de tratamiento de datos (DPA) viven **en el
silo** (decisión D6): cada centro puede tener su propia versión.

| Pieza | Dónde |
|---|---|
| Textos base (borradores para revisión legal) | `docs/cumplimiento/plantillas/terminos_servicio.md`, `dpa.md` |
| Versiones publicadas | `politicas` con tipo `TERMINOS_SERVICIO` o `DPA` (versión y fecha las fija la BD; append-only) |
| Quién publica | El operador de Vinculos, como dueño. El ADMIN del centro no puede (política `politicas_insert`) |
| Quién lee | Solo ADMIN (`politicas_select`, `politica_vigente()`); no son públicos |
| Aceptación | Un ADMIN, desde el aviso del panel o Configuración > Consentimiento y políticas. `aceptaciones_contrato`: versión, fecha y ADMIN |
| Pendientes | `contratos_pendientes()`: versión vigente sin aceptación. Mientras haya, el panel del ADMIN muestra el aviso para aceptar antes de seguir |

## Publicar una versión (operador)

En el contenedor `migrate` del silo (credenciales de dueño), con el texto
acordado con el centro:

```sql
INSERT INTO politicas (tipo, version, texto) VALUES ('TERMINOS_SERVICIO', 0, $texto$...$texto$);
INSERT INTO politicas (tipo, version, texto) VALUES ('DPA', 0, $texto$...$texto$);
```

La BD asigna la versión siguiente y la fecha. La versión anterior no cambia;
la nueva queda pendiente de aceptación. El centro de demostración las carga
desde las plantillas (`seed:demo`).

## Pendiente de validar

- Texto final con asesoría legal (las plantillas son borradores).
- Si la aceptación por un ADMIN basta como firma del representante del
  centro, o si se necesita además un documento firmado.
