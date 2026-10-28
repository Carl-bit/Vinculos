# AUD-01 - Brechas SaaS clínico Chile: cumplimiento, integraciones y producto

Auditoría del estado del repositorio al 2026-10-28 (rama `main` con los
cambios sin commit de 03b-4.2). Solo auditoría: no se modificó código,
migraciones ni pantallas.

Fuentes revisadas: `CLAUDE.md`, `docs/seguridad/*`, `docs/api/*`,
`docs/front/brechas.md`, `backend/prisma/schema.prisma`, migraciones,
`backend/prisma/tests/seguridad_bd.sql`, servicios y controladores de
`backend/src`, `infra/`, `frontend/src/components`. Además se corrió
`npm audit --omit=dev` en `backend` y `frontend` (resultado en CENS-S4).

Convenciones:
- Estado: CUMPLE / PARCIAL / FALTA / NO APLICA AÚN. Sin evidencia concreta
  no se marca CUMPLE.
- Prioridad: P1 antes de diciembre 2026; P2 antes del piloto; P3 futuro.
- **[Legal]** = el punto depende de interpretación legal. No se concluye;
  la pregunta queda al final.

---

## LEG - Roles legales y relación con el centro

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| LEG-01 | Datos de pacientes sin uso propio de la plataforma | PARCIAL | Técnicamente se cumple: no hay analítica de terceros en `frontend/package.json` ni en `backend/package.json`; la BD es una por silo (`CLAUDE.md`, "Arquitectura"); el match funciona por reglas, sin IA (`docs/front/brechas.md:310`). Falta el compromiso escrito: no hay términos ni DPA que lo declaren. | Declararlo en el DPA y en los términos (LEG-06). Agregar una regla en `CLAUDE.md`: "ningún job ni métrica sale del silo con datos de pacientes". | bajo | P1 |
| LEG-02 | Aislamiento por silo en componentes compartidos | PARCIAL | La BD, la API y el front van separados por silo (`infra/docker-compose.yml`). Se comparten en el host: Traefik (`infra/traefik/docker-compose.yml`, solo enruta, sin access log activo) y el remitente SMTP de plataforma (`SMTP_URL`, `docs/api/integraciones.md:104-110`; una cuenta de envío para todos los centros). Los logs van por silo a stdout con redacción (`backend/src/core/logs/logs.ts`); no se configura `logging:` en el compose ni hay agregador. No hay respaldos automáticos (ver CENS-S5), así que no se puede verificar que vayan separados. | Documentar qué es compartido y qué no. Usar un conjunto de configuración de SES por silo (o una etiqueta) para separar métricas y rebotes. Definir respaldos con destino separado por silo. Si se agrega un agregador de logs, una partición por silo. | medio | P1 |
| LEG-03 | Acceso de soporte del proveedor autorizado, con plazo, alcance y auditoría | FALTA | Hoy el operador del proveedor tiene `OWNER_DB_PASSWORD` y las llaves del silo (`docs/seguridad/runbooks_llaves.md:22-26`). Como dueño puede consultar la BD directamente: FORCE RLS lo sujeta a las políticas, pero el dueño puede alterarlas. No hay un flujo de autorización del centro, ni plazo, ni registro del acceso de soporte. Solo las operaciones de llaves quedan en `eventos_llaves`. | Diseñar el "acceso de soporte": solicitud, aprobación por ADMIN del centro, rol de BD temporal con alcance mínimo (sin datos clínicos por defecto) y vencimiento, y registro append-only visible para el centro. Documentar el procedimiento de emergencia ("break glass"). | alto | P1 |
| LEG-04 | Salida de un centro: exportación completa y eliminación del silo | FALTA | No hay exportación masiva. Lo que existe es por paciente y manual: la copia de ficha se pide y se resuelve fuera del sistema (`solicitudes_epicrisis.documento_ref`), y hay PDF por documento emitido (`fichas.controller.ts:470-484`). `revisiones_retencion` solo registra la decisión; la purga es manual (`docs/seguridad/retencion_datos.md`). No hay procedimiento escrito para eliminar un silo. | Comando de operador que exporte el silo descifrado en un formato estructurado (JSON/CSV por entidad, más PDF legible de cada ficha), con registro, entrega cifrada y acta. Runbook de baja del silo: exportar, acta de recepción, plazo, borrado de BD, volúmenes, respaldos y llaves, y acta de eliminación. | alto | P2 |
| LEG-05 | Lista documentada de subencargados | FALTA | No existe el documento. En el código aparecen: SMTP genérico (SES previsto), Let's Encrypt (`infra/traefik`), la pasarela (sin adaptador real) y AWS Lightsail (`CLAUDE.md`). | Crear `docs/cumplimiento/subencargados.md` (proveedor, país o región, finalidad, datos tratados y garantía de transferencia) para el anexo del DPA. | bajo | P1 |
| LEG-06 | Plantillas y versionado de documentos legales con registro de aceptación | PARCIAL | Para pacientes ya existe: `politicas` versionadas (`POLITICA_DATOS`, `CONSENTIMIENTO_ATENCION`, `TERMINOS_AGENDAMIENTO`, `CONSENTIMIENTO_PRACTICANTE`; `schema.prisma`, enum `TipoPolitica`) y `aceptaciones_politica` con versión, `aceptada_en`, titular u otorgante, canal y respaldo. Entre Vinculos y el centro no hay nada: ni términos de uso, ni DPA, ni su aceptación. Tampoco hay textos de plantilla redactados. | Agregar términos de uso del servicio y DPA, con aceptación por el representante del centro (versión, fecha, firmante). Pueden vivir fuera del silo, en el panel maestro; mientras tanto, como documento firmado. Redactar las plantillas base. **[Legal]** | medio | P1 |

## ARCOP - Derechos de los titulares (Ley 21.719)

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| ARCOP-01 | Registro de solicitudes con fecha, titular, estado y plazo de 30 días | FALTA | No hay tabla ni flujo. Lo más cercano es `solicitudes_epicrisis` (copia de ficha: estado y fechas, sin plazo legal ni tipo de derecho). | Tabla `solicitudes_derechos` (categoría A): tipo de derecho, titular, canal, verificación, estado y vencimiento. Vista para ADMIN con el plazo visible y una alerta antes del vencimiento. **[Legal]**: confirmar el plazo y si es prorrogable. | medio | P1 |
| ARCOP-02 | Acceso y portabilidad: exportación estructurada y auditada de un paciente | PARCIAL | El paciente pide la copia de ficha (`POST portal/epicrisis`, `match.controller.ts:274`) y descarga sus documentos emitidos; cada descarga queda en `descargas_documento`. No hay exportación estructurada (datos personales, citas, pagos, consentimientos) y la copia se resuelve a mano. | Endpoint de exportación por paciente (JSON más PDF), ejecutado por ADMIN ante una solicitud ARCOP-01 y registrado en `accesos_ficha` con una acción nueva `EXPORTACION`. | medio | P2 |
| ARCOP-03 | Rectificación con trazabilidad | PARCIAL | Se puede rectificar (`PATCH /api/pacientes/:id`, `fichas.controller.ts:126`), pero `pacientes.service.ts` (`editar`) no registra quién cambió qué: solo queda `updated_at`. Las evoluciones sí: la corrección es una fila nueva con `corrige_a_id` (`seguridad_bd.sql`, caso 15). | Historial append-only de cambios de datos personales (campo, quién, cuándo y rol; sin el valor en claro, o con el valor cifrado), o una fila en `accesos_ficha` con acción `ESCRITURA` y el recurso. | medio | P2 |
| ARCOP-04 | Cancelación: borra lo periférico y bloquea la ficha explicando el motivo | FALTA | No hay función de cancelación de paciente; `pacientes.deleted_at` existe pero no hay endpoint que lo use. Lo único automático: las respuestas del match se borran a los 30 días si no se concretan (`dias_retencion_respuestas_match`). La separación clínico/periférico está escrita (`retencion_datos.md`), no implementada como acción. | Función SECURITY DEFINER `cancelar_datos_perifericos(paciente)` que vacíe contacto, preferencias, respuestas del match y cuenta del portal, conserve la ficha y devuelva el motivo legal (Ley 20.584, Decreto 41). | medio | P2 |
| ARCOP-05 | Bloqueo temporal del tratamiento mientras se resuelve una solicitud | FALTA | Sin marca de bloqueo en `pacientes` ni efecto en jobs o envíos. | Marca `tratamiento_bloqueado` con motivo y vencimiento: suspende los correos no legales, el match y las comunicaciones, y muestra un aviso en las vistas. **[Legal]**: qué tratamientos siguen permitidos (la atención clínica en curso). | medio | P2 |
| ARCOP-06 | Oposición a comunicaciones no esenciales por canal | PARCIAL | `preferencias_notificacion` (`recordatorios`, `avisos_operativos`) solo afecta al correo; los avisos legales no se desactivan (`integraciones.md`, "Preferencias"). No hay preferencia por canal (WhatsApp) ni categoría de marketing. | Llevar las preferencias a la matriz categoría × canal (ver COM-04 y COM-05). | bajo | P2 |
| ARCOP-07 | Consentimientos separados y nunca premarcados | PARCIAL | Separados: política de datos, consentimiento de atención, términos de agendamiento y practicante (`TipoPolitica`); `HorarioPoliticasCentro.tsx:148` exige aceptación explícita. Faltan los consentimientos de comunicaciones por canal y de marketing. "Nunca premarcado" no tiene un test que lo asegure. | Agregar los tipos de consentimiento por canal y de marketing. Test (Vitest o Playwright) que verifique que las casillas de consentimiento parten desmarcadas. | bajo | P2 |
| ARCOP-08 | Solicitudes de pacientes sin cuenta con verificación por correo | FALTA | La copia de ficha exige sesión (`portal/epicrisis`). Hay verificación por correo para la solicitud de hora (`match.controller.ts:188`), pero no para derechos. | Formulario público de derechos con verificación por correo (mismo patrón de token de un solo uso) que crea la fila de ARCOP-01. **[Legal]**: qué verificación de identidad basta para datos de salud. | medio | P2 |

## BRE - Brechas de seguridad

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| BRE-01 | Procedimiento escrito de notificación de incidentes | FALTA | Solo existe el runbook de compromiso de llaves (`runbooks_llaves.md`), que es técnico y no trata la notificación al centro. | `docs/cumplimiento/incidentes.md`: detección, contención, aviso inmediato al centro (canal y contenido), y el centro decide la notificación a la Agencia y a los titulares. **[Legal]**: plazos y contenido mínimo de la notificación. | bajo | P1 |
| BRE-02 | Registro de incidentes | FALTA | Sin tabla ni plantilla. | Registro fuera del silo (es del proveedor) o plantilla versionada: fecha, alcance, datos afectados, medidas y notificaciones. | bajo | P1 |
| BRE-03 | Detección de accesos indebidos | PARCIAL | Existen: canarios de cifrado (`/api/salud` y alerta `FALLO_CANARIO`), `accesos_ficha` (solo ADMIN lo lee), `sesiones`, throttle de login (`auth.controller.ts:27-35`) y `alertas_internas`. No hay alertas por patrones (lecturas masivas de fichas, accesos fuera de horario, intentos fallidos repetidos), los intentos fallidos no se guardan y el monitoreo externo no avisa a nadie. | Job que revise `accesos_ficha` por umbrales y cree una `alerta_interna`; registro de intentos de login fallidos; alerta externa (correo al operador) por canario o salud caída. | medio | P2 |

## RET - Retención

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| RET-01 | Ficha inalterable, conservada al menos 15 años | CUMPLE | Evoluciones append-only, también como dueño (`seguridad_bd.sql`, casos 7 y 15); sin purga automática; `fichas_sobre_retencion()` y `revisiones_retencion` (`retencion_datos.md`). Lo mismo para documentos, adjuntos e ingresos. | Mantener. La conservación real depende además de los respaldos (CENS-S5). | — | — |
| RET-02 | Separación clara entre datos clínicos y periféricos | PARCIAL | Documentada (`retencion_datos.md`) y aplicada en purgas puntuales (mensajes internos, respuestas del match, `correos_cuenta_pendientes`). No hay una clasificación por columna "retener o suprimir" ni una acción que la aplique (ver ARCOP-04). | Agregar a `criterio_clasificacion.md` una columna "retención" (clínica / periférica / tributaria) por tabla, y usarla en ARCOP-04. | bajo | P2 |
| RET-03 | Minimización de datos del profesional al cerrar su cuenta | CUMPLE | `procesar_bajas()` vacía nombre, correo, teléfono, perfil, trayectoria y datos privados, y conserva la autoría cifrada (`retencion_datos.md`, "Cierre de cuenta"); trigger 23001 sobre la cuenta cerrada. | Mantener. | — | — |

## CENS-S - Sello CENS, seguridad

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| CENS-S1 | Cifrado en tránsito y en reposo | PARCIAL | Tránsito: Traefik redirige HTTP a HTTPS con Let's Encrypt (`infra/traefik/docker-compose.yml`), sin opciones de TLS (versión mínima, suites) y sin túnel configurado. Reposo en la aplicación: cifrado envolvente por columna (`cifrado.md`, `registro.ts`). Disco y respaldos: no configurado ni documentado; el respaldo queda protegido en las columnas cifradas, el resto va en claro (`cifrado.md:94`). | Fijar TLS 1.2 como mínimo en Traefik (`tls.options`) y documentar el túnel, si se usa. Documentar el cifrado de disco de Lightsail y cifrar los respaldos (CENS-S5). | bajo | P1 |
| CENS-S2 | Integridad: append-only y detección de alteraciones | PARCIAL | Append-only por trigger en registros clínicos, pagos y auditoría (`requisitos_02_apis.md:48`, 23001; `seguridad_bd.sql`, casos 7, 58 y 77). Sin detección de alteraciones: no hay hash encadenado ni firma de filas, así que un dueño que desactive el trigger no deja rastro. | Hash encadenado (o firma por fila) en `evoluciones`, `accesos_ficha` y `documentos_clinicos`, más un job verificador que alerte. | medio | P2 |
| CENS-S3 | Trazabilidad: quién creó, editó, vio o exportó, con rol activo | PARCIAL | `accesos_ficha` guarda usuario, **rol activo**, recurso, acción y fecha (`schema.prisma`, `AccesoFicha`; `core/bd/auditoria.ts`). Se registran: lectura de ficha, evoluciones, ingreso, adjuntos (subida y descarga), documentos (emisión, copia, envío), comprobantes de transferencia y casos de la mensajería. **Exportaciones y descargas:** la descarga del paciente queda en `descargas_documento`; la copia del tratante, como `LECTURA` (no hay acción `EXPORTACION` ni `DESCARGA`); los PDF de reporte y liquidación de Cobros (`cobros.controller.ts:86,93`) no se auditan, aunque solo traen agregados por profesional. La edición de datos del paciente no se audita (ARCOP-03). | Agregar las acciones `DESCARGA` y `EXPORTACION` a `AccionAcceso`; auditar la copia del tratante, los PDF de Cobros y la futura exportación; auditar la edición de pacientes. | bajo | P1 |
| CENS-S4 | Gestión de seguridad: roles, 2FA, contraseñas, dependencias | PARCIAL | Roles con RLS y guard `@Roles` (`matriz_permisos.md`); segundo factor por correo para todo el equipo (`matriz_permisos.md:403`); contraseña de 10 a 200 caracteres (`auth.dto.ts:76`); throttle de login. `npm audit --omit=dev` (2026-10-28): backend 14 vulnerabilidades (1 crítica `tar`, 9 altas, entre ellas `body-parser`, `multer`, `sharp`, `nodemailer` y `deepmerge-ts`); frontend 2 (1 alta). No hay CI (`.github` no existe) ni un proceso de actualización. | Actualizar las dependencias vulnerables. Agregar `npm audit` (o Dependabot) en CI con umbral alto. Escribir la política de contraseñas y de actualización. | medio | P1 |
| CENS-S5 | Disponibilidad: respaldos, restauración probada, monitoreo, RTO | PARCIAL | Restauración verificable a mano: `infra/scripts/llaves/verificar_respaldo.sh` (con `pg_dump -Fc` y simulacro trimestral en `cifrado.md:116`). No hay respaldo automático programado, destino externo, retención de respaldos, RTO/RPO definidos ni monitoreo con alerta (solo `/api/salud`). | Job de respaldo diario cifrado a un destino separado por silo, con retención definida y prueba de restauración registrada en `eventos_llaves`. Definir RTO/RPO por plan. Monitor externo con alerta. | medio | P1 |
| CENS-S6 | Personal administrativo sin acceso a notas clínicas | CUMPLE | BD: `seguridad_bd.sql`, casos 13 y 21 (ADMIN no lee evoluciones, ni por id), 77 (intervenciones) y 101 (GESTION nunca evoluciones). API: los guard `@Roles` dejan las evoluciones solo a PROFESIONAL y PRACTICANTE (`matriz_permisos.md:36-44`). Front: `VistaAdministrativa.tsx` y el menú por rol (`lib/navegacion.ts`). | Mantener. | — | — |

## CENS-U - Sello CENS, usabilidad

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| CENS-U1 | Principios de diseño y consistencia | PARCIAL | Sistema de diseño (`design-system/vinculos/MASTER.md`), primitivos en `components/ui/`, jerarquía de componentes (`CLAUDE.md`) y `impeccable` por vista. No hay un documento de principios de usabilidad orientado al sello. Quedan avisos abiertos de impeccable (`brechas.md:823-829`). | Redactar los principios de usabilidad con ejemplos por módulo como evidencia para CENS. | bajo | P3 |
| CENS-U2 | Prevención de errores: identificación del paciente, confirmaciones, validación | PARCIAL | Ficha y detalle: nombre, edad y badge de menor (`FichaClinica.tsx:84-90`); el detalle muestra además el RUT (`DetallePaciente.tsx:79-81`), pero la ficha clínica no muestra un identificador. No se verificó que el editor de evolución (`EditorEvolucion.tsx`) muestre al paciente de forma constante. Hay confirmaciones con `ui/Modal` y validación al salir del campo (pendiente 14, 03b-4.1). | Encabezado fijo del paciente (nombre, edad, RUT o código) en toda vista clínica, incluido el editor; test que lo verifique. | bajo | P2 |
| CENS-U3 | Visibilidad del estado del sistema | CUMPLE | Borrador con guardado automático y estados `vacio`, `pendiente`, `guardando`, `guardado` y `error` (`EditorEvolucion.tsx:29-31`); `shared/EstadoVista` para carga, vacío, error y sin permiso (`CLAUDE.md`); estados de pago y cita en Cobros y Agenda. | Mantener. | — | — |

## PAG - Pagos con conexión directa

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| PAG-01 | Pasarela configurable por centro o por profesional | PARCIAL | Existe la interfaz `ProveedorPasarela` (`core/integraciones/pasarela.ts`). Se elige por variable de entorno del silo (`PASARELA_PROVEEDOR`, `entorno.ts:165-184`), es decir, por centro. No por profesional: el modelo `DIRECTO` existe (`ModeloCobro`) pero comparte la pasarela del silo. No hay adaptador real. | Configuración de pasarela en BD por "cobrador" (centro o profesional con cobro DIRECTO), elegida según `cobrado_por` de la cita. Primer adaptador real. | alto | P2 |
| PAG-02 | Credenciales de pasarela cifradas (FINANCIERO), nunca en logs | NO APLICA AÚN | Ya existe la categoría de llave `FINANCIERO` (`CategoriaLlave`), usada en `cuentas_bancarias_centro`. Hoy el único secreto es `PASARELA_SECRETO_WEBHOOK`, en el entorno. La redacción de logs cubre los campos cifrados (`logs.ts`). | Al implementar PAG-01, las credenciales van en una columna `bytea` FINANCIERO más `registro.ts`, y se agregan a `SENSIBLES` en `logs.ts`. | bajo | P2 |
| PAG-03 | El pago ocurre en el checkout de la pasarela; Vinculos no toca tarjetas | CUMPLE | `crearCobro` devuelve `urlPago` y el paciente paga allá (`pasarela.ts:32`; `integraciones.md:162`, "Ningún dato de tarjeta pasa por la API"). Ninguna tabla guarda datos de tarjeta. | Mantener al escribir el adaptador real (redirección o tokenización). | — | — |
| PAG-04 | Datos enviados a la pasarela limitados a nombre, correo, RUT y monto | CUMPLE | `SolicitudCobro` envía solo `referencia`, `monto` y `retorno` (`pasarela.ts:5-12`), menos que el máximo permitido. | Si un proveedor exige nombre, correo o RUT, agregarlos explícitamente y nada más. | — | — |
| PAG-05 | Webhooks verificados por firma e idempotentes | CUMPLE | Firma HMAC-SHA256 en `x-pasarela-firma` (401 si falla) y `cobros_pasarela.evento_id` UNIQUE (`schema.prisma`, `CobroPasarela`); test `test/03b31-confirmacion-pago.e2e-spec.ts`. | Mantener en cada adaptador. | — | — |
| PAG-06 | Renombrar la "boleta" interna a "comprobante de pago" | FALTA | Se llama "boleta" en el modelo `Boleta`, la tabla `boletas`, la función `emitir_boleta`, el evento `BOLETA_EMITIDA` y el front (`PagosPortal.tsx`, `RegistrarAsistenciaPago.tsx` y otros). Lleva un número simulado (`cobros.service.ts:55-56`). | Cambiar los textos visibles y las plantillas ya, y renombrar en API y BD con una migración nueva (sin editar las aplicadas). | medio | P1 |
| PAG-07 | Modo demostración marcado; imposible en producción sin adaptador real | CUMPLE | `entorno.ts:182-184` impide arrancar con `simulada` en producción; sin adaptador, PASARELA da 422 `pasarela_sin_convenio`. La UI muestra "Modo demostración" (`shared/PasoPago.tsx`, con test `PasoPago.test.tsx`). | Mantener. | — | — |

## TRI - Documentos tributarios (boletas)

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| TRI-01 | Proveedor de boletas por centro o profesional según el modelo de cobro | FALTA | El SII está fuera de alcance (`requisitos_02_apis.md:235`, `estado_fase_api.md:214`). No hay interfaz. | Interfaz `ProveedorDocumentoTributario` en `core`, como la de la pasarela, elegida según el emisor. | medio | P3 |
| TRI-02 | Emisión manual: registrar folio y tipo emitido fuera del sistema | FALTA | La "boleta" se emite sola con número simulado al quedar pagada; no hay campos de folio ni de tipo de documento. | Tabla `documentos_tributarios` (folio, tipo, emisor, fecha, pago o cita) con registro manual por quien cobra. Es el paso intermedio antes de TRI-01. | bajo | P2 |
| TRI-03 | Credenciales tributarias cifradas con consentimiento del titular | NO APLICA AÚN | No hay proveedor tributario. | Al implementar: categoría FINANCIERO más registro de consentimiento expreso del titular. **[Legal]** | bajo | P3 |
| TRI-04 | Distinguir boleta de honorarios y boleta electrónica del centro | FALTA | `modelo_cobro` (CENTRO/DIRECTO) y `cobrado_por` existen y definen quién cobra, pero el documento no tiene tipo. | Campo `tipo` en TRI-02 (BOLETA_HONORARIOS / BOLETA_ELECTRONICA / otro), derivado del emisor. | bajo | P2 |

## COM - Comunicaciones

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| COM-01 | Envío por SES listo con SPF, DKIM y DMARC documentados | PARCIAL | `ProveedorCorreoSmtp` genérico sirve con el SMTP de SES (`integraciones.md:104-110`). SPF, DKIM y DMARC se mencionan solo para el dominio propio futuro (`integraciones.md:111-115`). No hay guía de SES (verificación del dominio de plataforma, salida del sandbox, rebotes y quejas). | `docs/api/correo_ses.md`: dominio de plataforma, registros DNS, salida del sandbox, manejo de rebotes y quejas (SNS) y región. | bajo | P1 |
| COM-02 | Reply-To con el correo del centro o del profesional | FALTA | `correo.ts:65-70` arma `from` (nombre del centro y dirección de plataforma) sin `replyTo`. | Agregar `replyTo` desde la configuración del centro, o el correo del profesional cuando corresponda. Calza con la regla de que el profesional responde por canal externo. | bajo | P1 |
| COM-03 | Ningún contenido clínico en correos (documentos por enlace) | CUMPLE | CHECK `plantillas_mensaje_variables_permitidas` (solo nombre, fecha, hora, modalidad, enlace y centro; `integraciones.md`, "Plantillas"); el documento va por enlace con sesión del paciente (`fichas.controller.ts:460-467`). | Mantener. | — | — |
| COM-04 | Consentimiento de WhatsApp al reservar, separado del resto | FALTA | `CanalMensaje.WHATSAPP` está reservado y un CHECK lo rechaza (`integraciones.md`, "Canales"). No hay captura de consentimiento por canal. | Casilla separada y desmarcada en la reserva y en el portal, guardada como aceptación versionada (por canal); preferencias por canal. | bajo | P2 |
| COM-05 | Plantillas clasificadas en utilidad y marketing | PARCIAL | `categoria_evento` (operativo, recordatorio, legal) clasifica la utilidad; no existe la categoría marketing ni plantillas de marketing. | Agregar la categoría `MARKETING`, que exige el consentimiento propio (ARCOP-07) y nunca se envía sin él. | bajo | P3 |
| COM-06 | Conteo de mensajes por canal y centro | PARCIAL | `notificaciones` guarda una fila por canal con estado, por silo (un silo = un centro). No hay reporte ni extracción agregada. | Consulta agregada sin datos personales (canal, mes, estado) para el panel maestro (PRO-02). | bajo | P3 |

## GOO - Google (futuro)

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| GOO-01 | Permisos mínimos, clasificación y requisitos de verificación | PARCIAL | Hay una nota de riesgo "Datos de salud en terceros" para eventos de Google (`integraciones.md`, sección de calendario). Hoy se usa iCalendar sin OAuth (`CalendarioIcs`). No hay lista de scopes, clasificación ni requisitos de verificación. | Documentar los scopes previstos, su clasificación según la lista oficial de Google (verificar en la fuente al momento) y los requisitos: página pública, política de privacidad en el mismo dominio y video. | bajo | P3 |

## PRO - Producto y comercial

| ID | Punto | Estado | Evidencia | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| PRO-01 | Módulos activos por centro y extras por configuración | PARCIAL | `configuracion_centro.modulos_activos` (`ModuloCentro`: PAGINA_PUBLICA, FICHAS, AGENDA, EQUIPO, MATCH, COBROS), que solo el operador cambia, con CHECK de coherencia (`matriz_permisos.md:251`). Los extras WhatsApp y boletas no son módulos. | Agregar `WHATSAPP` y `DOCUMENTOS_TRIBUTARIOS` al enum cuando existan. | bajo | P3 |
| PRO-02 | Métricas de uso por centro | FALTA | No hay endpoint ni consulta de métricas de uso. | Función de operador con agregados sin datos personales (profesionales activos, citas, mensajes por canal) para el panel maestro. | bajo | P3 |
| PRO-03 | Checklist de implementación de un centro nuevo | PARCIAL | `README.md`, "Desplegar un silo" (variables y secretos por silo), y aprovisionamiento de llaves y custodios (`runbooks_llaves.md` §1). Faltan: DNS y dominio, SES, respaldos, configuración inicial del centro (políticas, medios de pago, módulos), primer ADMIN, firma del DPA y capacitación. | `docs/cumplimiento/alta_centro.md` como checklist único que enlace lo existente. | bajo | P2 |
| PRO-04 | Estado de funciones de la competencia pospuestas | — | Paquetes de sesiones: no existe. Vitrina: hay perfiles públicos y match por centro (`perfiles_publicos()`); no hay vitrina entre centros (ver preguntas). Isapre y Fonasa: medio `CONVENIO`, "boleta reembolsable" y convenios en el perfil (`brechas.md:188,310`); sin integración. Receta electrónica: hay "receta" solo como tipo de documento clínico configurable en PDF, sin firma electrónica (`integraciones.md`, "Firma electrónica: pendiente"). IA: no hay; el match es por reglas (`brechas.md:310`). | Solo reporte. | — | — |

---

## Resumen de P1 (antes de diciembre 2026)

| ID | Qué | Esfuerzo |
|---|---|---|
| LEG-01 | Compromiso escrito de no uso propio (DPA y términos) | bajo |
| LEG-02 | Documentar lo compartido; separación por silo en SES y respaldos | medio |
| LEG-03 | Acceso de soporte autorizado, temporal, mínimo y auditado | alto |
| LEG-05 | Lista de subencargados | bajo |
| LEG-06 | Términos de uso y DPA con aceptación del centro; plantillas base | medio |
| ARCOP-01 | Registro de solicitudes de derechos con plazo | medio |
| BRE-01 | Procedimiento de notificación de incidentes | bajo |
| BRE-02 | Registro de incidentes | bajo |
| CENS-S1 | TLS mínimo en Traefik; cifrado de disco y respaldos documentado | bajo |
| CENS-S3 | Acciones `DESCARGA` y `EXPORTACION`; auditar copias, PDF y edición de pacientes | bajo |
| CENS-S4 | Corregir 14 + 2 vulnerabilidades; auditoría de dependencias en CI | medio |
| CENS-S5 | Respaldos automáticos cifrados, RTO/RPO y monitor con alerta | medio |
| PAG-06 | "Boleta" pasa a "comprobante de pago" | medio |
| COM-01 | Guía de SES con SPF, DKIM y DMARC | bajo |
| COM-02 | Reply-To del centro o del profesional | bajo |

Lo más pesado es LEG-03, porque cambia la operación del proveedor. Varios
puntos P1 son documentación (LEG-01, LEG-05, BRE-01, BRE-02 y COM-01) y no
tocan código.

## Contradicciones con decisiones tomadas

1. **Encargado vs. acceso del operador (LEG-03).** Si Vinculos es Encargado,
   solo debería tratar datos por instrucción del centro. Hoy el operador tiene
   la contraseña de dueño y las llaves de cada silo sin autorización ni
   registro del centro. El runbook lo llama "ADMIN de plataforma"
   (`runbooks_llaves.md:22`).
2. **Conexión directa por profesional (PAG-01).** La decisión dice "cada
   centro, o profesional con cobro directo, usa su propia cuenta". Hoy la
   pasarela es una por silo (variable de entorno): un profesional con cobro
   DIRECTO cobraría con la cuenta del centro.
3. **Boleta interna (PAG-06 y TRI).** El sistema "emite boletas" con número
   simulado (`cobros.service.ts:55-56`). Puede confundirse con un documento
   tributario, contra la decisión de distinguirlos.
4. **Correo de plataforma compartido (LEG-02 y COM-02).** Hay un solo
   remitente y una sola cuenta de envío para todos los centros, sin Reply-To.
   No mezcla datos en la BD, pero el proveedor de correo ve los
   destinatarios y asuntos de todos los centros en una cuenta. Encaja con
   "SES" mientras se documente como subencargado.
5. **Documentación interna desactualizada (no es una decisión de esta
   lista).** `matriz_permisos.md:46` dice "TOTP obligatorio para cuentas con
   rol clínico", pero la decisión vigente es segundo factor por correo, con
   TOTP apagado hasta 03b-5 (`matriz_permisos.md:403`).

No se encontraron contradicciones con "WhatsApp al final", "Google
pospuesto" ni "Vinculos nunca recibe dinero": no hay código de WhatsApp ni
de Google OAuth, y ningún flujo hace que la plataforma reciba fondos.

## Preguntas para ti

1. **[Legal]** ¿El plazo de respuesta a solicitudes ARCOP es de 30 días
   corridos o hábiles, y es prorrogable? (ARCOP-01)
2. **[Legal]** ¿Qué verificación de identidad basta para un titular sin
   cuenta que pide acceso a datos de salud: solo el correo registrado, o
   correo más RUT o documento? (ARCOP-08)
3. **[Legal]** Durante un bloqueo (ARCOP-05), ¿la atención clínica en curso
   sigue permitida? ¿Qué tratamientos se suspenden?
4. **[Legal]** ¿Plazo y contenido mínimo de la notificación del Encargado al
   centro ante un incidente? (BRE-01)
5. ¿El acceso de soporte (LEG-03) debe poder ver datos clínicos alguna vez,
   o nunca, aunque el centro lo autorice?
6. ¿La aceptación de términos y del DPA por el centro vive en el silo o en
   el panel maestro? (LEG-06)
7. Exportación de salida del centro (LEG-04): ¿basta JSON/CSV más PDF por
   ficha, o el centro espera algún formato de intercambio clínico específico?
8. "Vitrina" en PRO-04: ¿te refieres a un directorio entre centros
   (marketplace) o a la página pública de cada centro, que ya existe?
9. Renombre a "comprobante de pago" (PAG-06): ¿solo en textos visibles, o
   también en API y BD (requiere migración y regenerar el cliente)?
10. ¿Corrijo ya la línea 46 de `matriz_permisos.md` (TOTP vs. correo), o lo
    dejas para el cierre de la auditoría?

## Respuestas (2026-10-28)

Registradas como decisiones D1 a D10 en `docs/cumplimiento/roadmap_aud01.md`,
que ordena el trabajo por entregas. Resumen:

1. Plazo en dias **habiles**.
2. El titular sin cuenta se identifica por RUT. Se confirma el correo
   registrado y la informacion se envia ahi, salvo que pida actualizarlo.
   La invitacion a crear cuenta se envia una sola vez.
3. El bloqueo se muestra e impide **nuevas** gestiones. Lo ya agendado se
   mantiene; depende del periodo del bloqueo.
4. Estandar propio de plazo y contenido minimo: `docs/cumplimiento/incidentes.md`.
5. El soporte **nunca** ve datos personales ni clinicos.
6. Terminos de servicio y DPA viven en el silo (distintos por centro).
7. Exportacion JSON + PDF; el contenido se define antes de implementar
   (roadmap, E3.0).
8. Sin vitrina por ahora. Mas adelante: landing de Vinculos con una seccion
   de centros que enlaza a sus paginas.
9. Se manejan ambos: comprobante de pago (no tributario) y registro de la
   boleta SII emitida fuera. El renombre llega a BD y API.
10. `matriz_permisos.md:46` corregida: segundo factor por correo, sin TOTP.

Avance de las entregas: ver la seccion "Estado" de `roadmap_aud01.md`.

## Estado tras AUD-01 Fases 0, 1 y 2 (2026-10-28)

| Grupo | Puntos cerrados en el codigo | Abiertos |
|---|---|---|
| LEG | 01, 02 (Reply-To, configuration set por silo), 03 (soporte), 04 (Fase 3: exportacion cifrada y baja), 05, 06 | — |
| ARCOP | 01, 02 (Fase 3), 03, 04, 05, 06, 07, 08 | — |
| BRE | 01, 02 (estandar y plantilla), 03 | — |
| RET | 01, 02, 03 | — |
| CENS-S | 1 (TLS 1.2; respaldo cifrado), 3, 4 (0 vulnerabilidades de produccion; `npm run auditoria`), 5 (respaldos, RTO/RPO, monitor), 6 | 2 (hash encadenado, post-MVP) |
| CENS-U | 3 | 1, 2 (post-MVP) |
| PAG | 03, 04, 05, 06, 07; 01 y 02 alineados (pasarela solo del centro) | pasarela por cobrador (post-MVP) |
| TRI | 02, 04 | 01, 03 (post-MVP) |
| COM | 01, 02, 03, 04 | 05, 06 (post-MVP, con WhatsApp) |

Fuera del codigo: servidor y bucket (puesta en marcha), revision legal de
plantillas y plazos, feriados 2027 por verificar.
