# Backlog posterior al MVP (2026-11-07)

Trabajo acordado para despues del MVP, para que no se pierda. Cada item
indica de donde salio. Se mueve al plan activo cuando se decida retomarlo.

## Funcionalidad

| Item | Origen | Nota |
|---|---|---|
| Cobros: reglas de negocio completas, PDF de reporte y de liquidacion fuera de la peticion, indice `pagos (estado, fecha)` y paginacion de `/cobros/citas` (181 KB hoy) | AUD-02 (BD-03, BD-05, API-03); decision 2026-11-06 | Cuando el usuario cierre las reglas de finanzas |
| Pasarela de pago real (conexion directa, Vinculos no recibe dinero) con clave de idempotencia por intento | Orden MVP 2026-10-30; AUD-02 EXT-02 | Hoy solo la simulada |
| RNPI automatico (Superintendencia) | AUD-02, 2026-11-06 | Hoy manual: numero SIS + documento y verificacion del ADMIN. Con la apikey, sacar la consulta de la transaccion de la peticion antes de activarla |
| TOTP (app autenticadora) | 03b-4.1 | Apagado (`TOTP_HABILITADO=false`); el segundo factor es por correo |
| Lista de espera | 03b-3.2 | Retirada; si vuelve, LIBERADA es el punto donde avisar |
| Menores (D-4) | 03b-4.1 | Revision legal antes de pacientes reales |
| Fusion de pacientes duplicados | 03b-4.1 | Hoy `MISMO_PACIENTE` y conciliacion manual |
| Permisos a medida por rol (capacidades) | Punto 36, 2026-11-11 | Reescribir la RLS (~100 tablas) a permisos por capacidad. En el MVP: perfiles sobre un rol base que solo restringen secciones |
| Avisos por WhatsApp | MVP 2026-11-11 | Modulo oculto en Configuracion; el codigo queda para despues |

## Operacion y rendimiento

| Item | Origen | Nota |
|---|---|---|
| Quitar `passport`, `passport-jwt` y `@nestjs/passport` (sin uso) | AUD-02 API-04 | Bajo |
| Correos FALLIDOS visibles para el ADMIN | AUD-02 COLA-02 | Configuracion > Notificaciones |
| Web Vitals propios solo en el sitio publico | AUD-02 OBS-03 | Sin analitica de terceros |
| Varias replicas de la API: almacen del rate limit en Postgres o Redis del silo; registrar la instancia que corre la exportacion del centro | AUD-02 INFRA-05 | Solo si se escala horizontalmente |
| Redis por silo (opcional) | AUD-02 CACHE | Solo si un silo cumple CACHE-06 (p95 publico > 300 ms por 7 dias) |
| Invalidacion inmediata del sitio publico (`revalidateTag`) al publicar perfil, tarifas o contenido | AUD-02 CACHE-05 | Hoy hasta 60 s |
| React Profiler en Agenda y Ficha | 03b-6 | Revision manual |
| Formatear con Prettier 12 archivos que ya venian sin formato | 03b-6 | `npx prettier --write` |
| Seguimiento en vivo de una exportacion programada | Exportacion programada | Hoy avisa por correo y muestra el estado al volver a entrar |
