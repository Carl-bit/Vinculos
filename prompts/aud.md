# AUD-01 - Auditoría SaaS clínico Chile: cumplimiento, integraciones y producto

## Contexto
Comparar el estado actual del sistema contra los puntos de abajo, surgidos del análisis legal, técnico y comercial del SaaS. Leer CLAUDE.md, docs/seguridad/*, docs/api/*, docs/front/brechas.md, el schema y los tests.
Esta tarea es SOLO de auditoría: no modificar código, migraciones ni pantallas.

## Decisiones ya tomadas (no cuestionar, solo verificar contra ellas)
- Vinculos es Encargado del tratamiento; cada centro es Responsable.
- Pagos con conexión directa: cada centro (o profesional con cobro directo) usa su propia cuenta de pasarela. Vinculos nunca recibe ni retiene dinero.
- Correo transaccional con Amazon SES.
- WhatsApp Business al final, como extra, con la cuenta y el número del centro (registro integrado de Meta).
- Google pospuesto.
- Objetivo futuro: Sello CENS de Registro Clínico Electrónico (requiere un centro en producción).

## Entregable
docs/cumplimiento/brechas_saas.md con una tabla por grupo:
ID | Punto | Estado (CUMPLE / PARCIAL / FALTA / NO APLICA AÚN) | Evidencia (archivo, tabla, endpoint o test) | Acción propuesta | Esfuerzo (bajo / medio / alto) | Prioridad (P1 antes de diciembre 2026 / P2 antes del piloto / P3 futuro)
Al final: resumen de P1, lista de contradicciones con decisiones tomadas y preguntas para mí. Detenerse ahí.

## Puntos a verificar

### LEG - Roles legales y relación con el centro
- LEG-01 Ningún dato de pacientes se usa para fines propios de la plataforma (analítica entre centros, entrenamiento, marketing).
- LEG-02 Aislamiento por silo: ningún componente compartido (logs, métricas, correo, respaldos) mezcla datos de distintos centros.
- LEG-03 Acceso de soporte del proveedor: hoy, ¿cómo accedería el equipo de Vinculos a un silo para dar soporte? Debe requerir autorización del centro, tener plazo, alcance mínimo y quedar auditado.
- LEG-04 Salida de un centro: exportación completa de sus datos (incluidas fichas, en formato estructurado y legible) para que siga cumpliendo la retención de 15 años, y procedimiento de eliminación del silo después.
- LEG-05 Lista de subencargados documentada (AWS, SES, Cloudflare si se usa, proveedores de boletas y pagos), con país y finalidad, para el anexo de tratamiento de datos.
- LEG-06 Plantillas y versionado de documentos legales: términos de uso, política de privacidad, anexo de tratamiento de datos (DPA) y consentimiento informado. Cada aceptación guarda versión, fecha y titular.

### ARCOP - Derechos de los titulares (Ley 21.719)
- ARCOP-01 Registro de solicitudes (acceso, rectificación, cancelación, oposición, portabilidad, bloqueo) con fecha, titular, estado y plazo de 30 días visible para el centro.
- ARCOP-02 Acceso y portabilidad: exportación de los datos de un paciente en formato estructurado, auditada.
- ARCOP-03 Rectificación de datos personales con trazabilidad del cambio.
- ARCOP-04 Cancelación: elimina datos periféricos (contacto, preferencias, respuestas del match) pero bloquea la eliminación de la ficha clínica, explicando el motivo legal.
- ARCOP-05 Bloqueo temporal del tratamiento de un dato mientras se resuelve una solicitud.
- ARCOP-06 Oposición: el paciente puede oponerse a comunicaciones no esenciales por canal.
- ARCOP-07 Consentimientos separados y nunca premarcados: tratamiento de datos, atención, practicante, comunicaciones por cada canal y, si existiera, marketing.
- ARCOP-08 Solicitudes de pacientes sin cuenta (con verificación por correo).

### BRE - Brechas de seguridad
- BRE-01 Procedimiento escrito de notificación de incidentes: el proveedor avisa al centro de inmediato; el centro decide la notificación a la Agencia y a los titulares.
- BRE-02 Registro de incidentes (fecha, alcance, datos afectados, medidas, notificaciones).
- BRE-03 Detección: qué alertas existen hoy que permitirían descubrir un acceso indebido.

### RET - Retención
- RET-01 Ficha clínica inalterable y conservada al menos 15 años.
- RET-02 Separación clara entre datos clínicos (se retienen) y periféricos (se pueden suprimir).
- RET-03 Minimización de datos del profesional al cerrar su cuenta.

### CENS-S - Sello CENS, seguridad
- CENS-S1 Confidencialidad: cifrado en tránsito (configuración TLS prevista en Traefik y túnel) y en reposo (aplicación, disco y respaldos).
- CENS-S2 Integridad: registros clínicos y de auditoría append-only; detección de alteraciones.
- CENS-S3 Trazabilidad: quién creó, editó, vio o exportó cada registro, con fecha, hora y rol activo. Verificar especialmente que las EXPORTACIONES y DESCARGAS queden auditadas.
- CENS-S4 Gestión de seguridad: control de acceso por rol, segundo factor, políticas de contraseña, revisión de dependencias vulnerables (npm audit u otra herramienta) y proceso para actualizarlas.
- CENS-S5 Disponibilidad: respaldos, restauración probada, monitoreo, objetivo de tiempo de recuperación.
- CENS-S6 Personal administrativo sin acceso a notas clínicas (verificar en API, BD y front).

### CENS-U - Sello CENS, usabilidad
- CENS-U1 Principios de diseño y consistencia entre módulos (componentes, textos, patrones).
- CENS-U2 Prevención de errores: identificación visible y constante del paciente en toda vista clínica (nombre, edad, identificador) para evitar registrar en el paciente equivocado; confirmaciones antes de acciones irreversibles; validaciones en el momento.
- CENS-U3 Visibilidad del estado del sistema: indicadores de guardado y borrador, carga, envío de mensajes, estado de pagos y citas.

### PAG - Pagos con conexión directa
- PAG-01 Interfaz de proveedor de pasarela configurable por centro o por profesional (cobro directo).
- PAG-02 Credenciales de pasarela cifradas (categoría FINANCIERO), nunca en logs.
- PAG-03 El pago se realiza en el checkout de la pasarela (redirección, iframe o SDK con tokenización). Vinculos nunca recibe ni guarda números de tarjeta, CVV ni vencimientos.
- PAG-04 Datos enviados a la pasarela limitados a nombre, correo, RUT y monto.
- PAG-05 Webhooks verificados (firma) e idempotentes.
- PAG-06 Renombrar la "boleta" interna a "comprobante de pago" para no confundirla con el documento tributario.
- PAG-07 Modo demostración claramente marcado; imposible activarlo en producción sin adaptador real.

### TRI - Documentos tributarios (boletas)
- TRI-01 Interfaz de proveedor de boletas por centro o profesional, según el modelo de cobro.
- TRI-02 Emisión manual: registrar folio y tipo de documento emitido fuera del sistema.
- TRI-03 Si un proveedor requiere credenciales tributarias, almacenamiento cifrado y consentimiento expreso del titular.
- TRI-04 Distinguir boleta de honorarios (profesional independiente) y boleta electrónica del centro.

### COM - Comunicaciones
- COM-01 Envío por SES listo: configuración, documentación de SPF, DKIM y DMARC.
- COM-02 Reply-To con el correo del centro o del profesional.
- COM-03 Ningún contenido clínico en correos (salvo documentos emitidos, por enlace).
- COM-04 Preferencias por canal preparadas para WhatsApp: consentimiento explícito de comunicaciones por WhatsApp capturado al reservar, separado del resto.
- COM-05 Clasificación de plantillas en utilidad (citas, pagos) y marketing; marketing exige consentimiento propio.
- COM-06 Conteo de mensajes por canal y centro (para cobrar WhatsApp como extra en el futuro).

### GOO - Google (futuro)
- GOO-01 Documentar permisos mínimos previstos, su clasificación (sensible o restringido según la lista oficial de Google) y requisitos de verificación (página pública, política de privacidad en el mismo dominio, video de demostración).

### PRO - Producto y comercial
- PRO-01 Módulos activos por centro y activación de extras (WhatsApp, boletas) por configuración.
- PRO-02 Métricas de uso por centro (profesionales activos, citas, mensajes) para facturación y soporte.
- PRO-03 Checklist de implementación de un centro nuevo (silo, dominio, llaves, custodios, configuración inicial, capacitación).
- PRO-04 Estado de funciones que la competencia ofrece y se pospusieron: paquetes de sesiones, vitrina, integración Isapre y Fonasa, receta electrónica, IA. Solo reportar el estado; no proponer implementación.

## Reglas
- La evidencia debe ser concreta (archivo y línea, tabla, endpoint o test). Si no hay evidencia, el estado no puede ser CUMPLE.
- No inventar requisitos legales: si un punto depende de interpretación legal, marcarlo y dejar la pregunta.
- Entregar el informe y detenerse.




------------------------------------------------------------------------------------------------------------------


# AUD-02 - Auditoría de rendimiento y operación

## Contexto
Comparar el estado actual del sistema contra los puntos de abajo, enfocados en rendimiento, capacidad y operación de cada silo. Leer CLAUDE.md, docs/seguridad/*, docs/api/*, el schema de Prisma, los docker-compose, la configuración de Traefik y los tests.
Esta tarea es SOLO de auditoría: no modificar código, migraciones, configuración ni infraestructura.

## Decisiones ya tomadas (no cuestionar, solo verificar contra ellas)
- Un silo por centro: contenedores y base de datos propios. Ningún componente compartido mezcla datos de distintos centros.
- Servidor objetivo: Lightsail de 512 MB y 1 vCPU por plan base; varios silos pueden compartir host detrás de Traefik.
- Holds de reserva con TTL en Postgres; la restricción EXCLUDE es el respaldo final contra choques.
- Ningún dato clínico, RUT, token ni credencial en logs, trazas, métricas, cachés ni herramientas de terceros.
- La IA asistida vive en la rama feat/ia-asistida; queda fuera de esta auditoría.
- Pagos con conexión directa: Vinculos nunca recibe ni retiene dinero.

## Entregable
docs/operacion/auditoria_rendimiento.md con una tabla por grupo:
ID | Punto | Estado (CUMPLE / PARCIAL / FALTA / NO APLICA AÚN) | Evidencia (archivo y línea, tabla, endpoint o test) | Medición actual (o SIN MEDIR + cómo medirlo) | Acción propuesta | Esfuerzo (bajo / medio / alto) | Prioridad (P1 antes de la entrega y demo / P2 antes del piloto / P3 futuro)
Al final: resumen de P1, presupuesto de memoria por silo (sección CAP), recomendación sobre Redis (sección CACHE), contradicciones con decisiones tomadas y preguntas para mí. Detenerse ahí.

## Puntos a verificar

### BD - Base de datos
- BD-01 Consultas N+1: revisar include y relaciones en listados (pacientes, agenda por semana y por box, sesiones, cobros). Reportar el número de consultas por petición en los 5 endpoints más usados.
- BD-02 Solo las columnas necesarias: uso de select en Prisma. Señalar dónde se traen y descifran columnas cifradas que la respuesta no usa.
- BD-03 Índices: EXPLAIN ANALYZE de agenda por box y rango de fechas, búsqueda por rut_hmac, sesiones por profesional y estado, cobros por estado y período, accesos_ficha por paciente. Listar índices faltantes y sobrantes.
- BD-04 Pool de conexiones: límite del pool de Prisma por silo, max_connections de Postgres y suma total si varios silos comparten host. Indicar si hace falta PgBouncer.
- BD-05 Transacciones largas: detectar transacciones que mantienen set_config de RLS abiertas más de lo necesario o que llaman a servicios externos dentro de la transacción.

### API - Endpoints
- API-01 Paginación en todos los listados, con máximo por página y orden estable. Listar los endpoints sin paginar.
- API-02 Peticiones independientes en paralelo dentro de un mismo caso de uso, en vez de en cadena.
- API-03 Tamaño de respuestas: campos de más, objetos anidados innecesarios y respuestas mayores a 100 KB.
- API-04 Dependencias sin usar en la API y resultado de npm audit con severidad.
- API-05 Compresión de respuestas (en la API o en Traefik, no en ambos).

### COLA - Trabajos en segundo plano
- COLA-01 Inventario de tareas lentas que hoy corren dentro de la petición: correos, PDFs, recordatorios, vencimiento de holds y retenciones, listados de purga.
- COLA-02 Propuesta de cola sobre Postgres (por ejemplo pg-boss): reintentos, tareas muertas, idempotencia y visibilidad del estado para el ADMIN.
- COLA-03 Trabajos programados: qué corre hoy, con qué mecanismo y qué pasa si el contenedor se reinicia en medio.

### EXT - Servicios externos
- EXT-01 Timeout explícito y reintentos acotados en SES, RNPI, pasarelas de pago y Mailpit.
- EXT-02 Clave de idempotencia en toda operación de pago que se reintente.
- EXT-03 Comportamiento ante caída del servicio externo: qué ve el usuario y qué queda pendiente para reintentar.

### CACHE - Caché por silo
- CACHE-01 Qué datos se leen repetidamente sin cambiar (catálogo público, disponibilidad agregada, configuración del centro, tipos de atención). Medir frecuencia y tiempo.
- CACHE-02 Evaluar una interfaz de caché con dos adaptadores (memoria por defecto y Redis opcional por silo), activada por configuración y perfil de Docker Compose. Nunca un Redis compartido entre silos.
- CACHE-03 Si se recomienda Redis: memoria máxima, política de descarte, sin persistencia, contraseña, solo red interna del silo, y su costo en memoria dentro del presupuesto CAP.
- CACHE-04 Lista explícita de lo que NUNCA va a caché: datos clínicos, RUT, correos, teléfonos, tokens, credenciales y holds de reserva.
- CACHE-05 Invalidación: cuándo se borra cada clave (cambio de tarifa, de horario, de perfil, de configuración).
- CACHE-06 Criterio medible para activar Redis en un silo (propuesta inicial: p95 del catálogo público mayor a 300 ms o mayoría del tiempo de BD en lecturas repetidas).

### INFRA - Infraestructura
- INFRA-01 Compresión Brotli o Gzip en Traefik o Cloudflare.
- INFRA-02 Estáticos: encabezados de caché de larga duración para archivos con hash; CDN de Cloudflare solo para estáticos. Verificar que ninguna respuesta autenticada quede en caché.
- INFRA-03 Límites de recursos por contenedor (memoria y CPU) definidos en los compose y coherentes con el plan de 512 MB.
- INFRA-04 Cercanía API y base de datos: hoy comparten host y red; documentar la regla para producción (misma región si la base pasa a un servicio gestionado).
- INFRA-05 Escalado horizontal: verificar que la API no guarde estado en memoria que impida tener varias réplicas (sesiones, holds, colas). Solo documentar el camino; no implementar.

### OBS - Observabilidad
- OBS-01 Medición de peticiones lentas: propuesta de OpenTelemetry (API y Prisma) o alternativa más liviana para el plan de 512 MB.
- OBS-02 Las trazas, logs y métricas no llevan contenido clínico, RUT, tokens ni cuerpos de petición. Verificar los logs actuales.
- OBS-03 Velocidad de usuarios reales (Web Vitals) solo en el sitio público, con recolección propia y sin analítica de terceros en vistas clínicas o del portal.
- OBS-04 Alertas mínimas: contenedor caído, disco sobre 80%, respaldos fallidos, errores 5xx sostenidos.

### CAP - Capacidad por silo
- CAP-01 Memoria en reposo y bajo carga de cada contenedor del silo (API, front, Postgres, y Redis si se recomienda).
- CAP-02 Cuántos silos caben por host con el plan actual y cuál es el primer cuello de botella.
- CAP-03 Prueba de carga k6 existente: escenarios cubiertos y resultados. Proponer un escenario adicional de lectura del catálogo público y de agenda semanal.

## Reglas
- La evidencia debe ser concreta (archivo y línea, tabla, endpoint, test o medición). Si no hay evidencia, el estado no puede ser CUMPLE.
- Si algo no se puede medir en el entorno actual, marcar SIN MEDIR y describir el comando o la prueba para medirlo.
- No proponer servicios pagados ni componentes compartidos entre silos sin señalarlo como contradicción.
- Entregar el informe y detenerse.