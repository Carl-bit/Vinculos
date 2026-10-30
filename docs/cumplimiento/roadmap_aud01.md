# Roadmap AUD-01 - Cómo atacar las brechas del SaaS

Base: `docs/cumplimiento/brechas_saas.md` (2026-10-28) y las respuestas del
usuario del mismo día. Este documento solo ordena el trabajo; nada se
implementa sin aprobar la entrega correspondiente.

Cada entrega trae lo mismo:
- **Cambia**: qué se toca (código, BD, docs).
- **Dónde verlo**: ruta y usuario demo (`docs/pruebas/usuarios_demo.md`)
  para revisarlo en pantalla, o el documento si no tiene UI.
- **Pruebas**: lo que se corre y se reporta con su resultado real.
- **Aprobación**: la condición para darla por cerrada y pasar a la
  siguiente.

Regla de avance: una entrega a la vez. Se revisa, se aprueba y recién
entonces sigue la próxima. Sin commits: al cerrar cada entrega se propone el
mensaje.

---

## Decisiones recibidas (2026-10-28)

| # | Tema | Decisión | Afecta |
|---|---|---|---|
| D1 | Plazo de solicitudes de derechos | Días **hábiles** | ARCOP-01 |
| D2 | Identificación de un titular sin cuenta | Por **RUT**. El correo registrado solo recibe notificaciones (confirmaciones, pagos, etc.). La invitación a crear cuenta se envía **una sola vez**; el paciente puede crearla por su cuenta si lo prefiere | ARCOP-08 |
| D3 | Bloqueo del tratamiento | Se muestra el bloqueo y **no se permiten más gestiones** sobre ese paciente mientras dure | ARCOP-05 |
| D4 | Incidentes | Plan de contingencia con un **estándar propio de plazo y contenido mínimo** de la notificación al centro | BRE-01, BRE-02 |
| D5 | Acceso de soporte | **Nunca** ve datos personales ni clínicos: cifrados o no expuestos | LEG-03 |
| D6 | Términos y DPA | Viven **en el silo**: cada centro puede tener los suyos | LEG-06 |
| D7 | Exportación del centro | JSON más PDF legible. El contenido exacto **se discute antes** de implementar | LEG-04, ARCOP-02 |
| D8 | Vitrina | No existe ahora. Después: landing de Vinculos con una sección de centros que enlaza a sus páginas | PRO-04 (P3) |
| D9 | Comprobante y boleta | Se manejan **ambos**: comprobante de pago interno (no tributario) y registro de la boleta SII emitida fuera, para evitar malentendidos | PAG-06, TRI-02, TRI-04 |
| D10 | Segundo factor | En esta entrega va por correo; TOTP no se usa. Hay que corregir la matriz | doc |

---

## Fase 0 - Vulnerabilidades (urgente)

### E0.1 Dependencias sin cambio de API

Diagnóstico (`npm audit --omit=dev`, 2026-10-28):

| Paquete | Severidad | Viene de | Corrección propuesta |
|---|---|---|---|
| `tar` <=7.5.20 | crítica | `bcrypt@5` -> `@mapbox/node-pre-gyp` | Subir a `bcrypt@6`: trae binarios precompilados, sin `node-pre-gyp`, y la API `hash`/`compare` no cambia. Los hashes existentes siguen siendo válidos (mismo formato `$2b$`) |
| `body-parser`, `multer`, `qs`, `nodemailer` | alta / moderada | Nest Express y correo | `npm audit fix`, sin cambios mayores |
| `deepmerge-ts` <8 | alta | `prisma@6` (CLI, va en la imagen `migrate`) | `overrides` a `deepmerge-ts@^8` antes que subir a Prisma 7 (Prisma 7 es una migración grande: generador y adaptadores) |
| `js-yaml` 5.0-5.4 | moderada | `@nestjs/swagger@11` | `overrides` a la versión corregida antes que subir a swagger 12 |
| `sharp` <=0.35.5-rc.1 | alta | imágenes públicas | Subir a `sharp@0.35.5` (cambio de minor en 0.x, revisar las notas de la versión) |
| `postcss` <=8.5.22 (frontend) | alta | `next@15` fija `postcss@8.4.31` | `overrides` de `postcss` dentro de `next` a `^8.5.30` (la que ya usa Tailwind), sin subir a Next 16 |

- **Cambia**: `backend/package.json`, `frontend/package.json` y sus
  lockfiles. Sin código, salvo lo que exija `bcrypt@6` o `sharp`.
- **Dónde verlo**:
  - Login de `admin` y `paciente` con las contraseñas del seed (prueba de
    `bcrypt`).
  - `/admin/perfil` subiendo una foto (prueba de `sharp`).
  - Un correo en Mailpit (prueba de `nodemailer`).
  - El sitio público (`/`) carga los estilos (prueba de `postcss`).
- **Pruebas**:
  - `npm audit --omit=dev` en ambos, antes y después.
  - `tsc` del backend.
  - Tests unitarios de backend y frontend.
  - Integración del backend.
  - `correr_tests_bd.sh`.
  - `npm run build` del frontend.
  - Playwright completo tras `demo:reset`.
- **Aprobación**: 0 críticas y 0 altas en ambos proyectos; todos los tests
  como antes (59/59 en Playwright). Si un override no basta, se informa la
  alternativa mayor (Prisma 7, swagger 12, Next 16) como decisión aparte,
  sin aplicarla.

### E0.2 Que no vuelva a pasar

- **Cambia**: script `npm run auditoria` (audit con umbral `high`, ambos
  proyectos) y una sección en `docs/seguridad/` con el proceso: revisión
  semanal y antes de cada despliegue, y quién decide las subidas mayores.
  Si se crea CI más adelante, el mismo script queda como gate.
- **Dónde verlo**: documento y salida del script.
- **Aprobación**: el script falla con una alta o crítica y pasa limpio tras
  E0.1.

---

## Fase 1 - Alinear las contradicciones con las decisiones

Cada contradicción del informe con su medida. **Ahora** = antes de cerrar
el MVP. **Post-MVP** = queda diseñado y documentado, sin implementar.

| # | Contradicción | Ahora (MVP) | Post-MVP |
|---|---|---|---|
| C1 | El operador accede al silo como dueño, sin autorización del centro (Vinculos es Encargado) | E2.1: rol de soporte que no lee datos personales ni clínicos (D5), autorización con plazo dada por ADMIN y registro visible para el centro. Credenciales de dueño solo para mantención documentada (migraciones y llaves), registrada como evento. Declararlo en el DPA | Panel maestro con las solicitudes de soporte centralizadas (sin datos del silo) |
| C2 | Una pasarela por silo; un profesional con cobro DIRECTO cobraría con la cuenta del centro | E1.3: el medio PASARELA solo se puede habilitar con modelo CENTRO; con DIRECTO, 422 con un mensaje claro ("cada profesional necesita su propia cuenta de pasarela; disponible más adelante"). Documentar el diseño "pasarela por cobrador" | Configuración de pasarela por cobrador en BD (credenciales FINANCIERO cifradas) y adaptadores reales |
| C3 | La "boleta" interna se confunde con la boleta del SII | E1.4: renombrar a "comprobante de pago" (no tributario) y agregar el registro de la boleta SII emitida fuera (folio, tipo, emisor) (D9) | Proveedor de boletas electrónicas por emisor (TRI-01) |
| C4 | Un remitente y una cuenta de correo para todos los centros, sin Reply-To | E1.2: `replyTo` con el correo del centro (configurable por ADMIN). E1.1: SES declarado como subencargado y guía de SES con un conjunto de configuración por silo (métricas y rebotes separados) | Dominio propio por centro (SPF, DKIM y DMARC del centro) |
| C5 | La matriz dice "TOTP obligatorio" | E1.1: corregir `matriz_permisos.md:46` a "segundo factor por correo para todo el equipo" (D10) | TOTP en 03b-5, si se retoma |

WhatsApp: no hay contradicción hoy. Para que el post-MVP no obligue a
rehacer nada, E2.3 deja lista la captura del consentimiento por canal, que
para WhatsApp parte desmarcado. El envío queda post-MVP.

### E1.1 Documentos (sin código)

- **Cambia**:
  - `matriz_permisos.md:46` (C5).
  - `docs/cumplimiento/subencargados.md` (LEG-05): AWS Lightsail, SES,
    Let's Encrypt, la pasarela por definir y el proveedor de boletas por
    definir, con país y finalidad.
  - `docs/cumplimiento/incidentes.md` (BRE-01, BRE-02, D4): clasificación por
    severidad, plazos propios del proveedor para avisar al centro, contenido
    mínimo del aviso, plantilla del registro y responsables. Los plazos son
    los nuestros; los de la Agencia los decide el centro.
  - `docs/api/correo_ses.md` (COM-01).
  - Compromiso de no uso propio de los datos (LEG-01), como cláusula base
    del DPA de E2.2.
  - Respuestas D1 a D10 registradas en `brechas_saas.md`.
- **Dónde verlo**: los documentos.
- **Aprobación**: revisas y apruebas el estándar de incidentes (plazos y
  contenido) y la lista de subencargados.

### E1.2 Correo y TLS

- **Cambia**:
  - Campo `correo_respuesta` en `configuracion_centro`. Va con migración, y
    se pide confirmar si se cifra: es un correo institucional, no de un
    paciente.
  - `replyTo` en `ProveedorCorreoSmtp`.
  - `tls.options` con TLS 1.2 como mínimo en Traefik (CENS-S1).
- **Dónde verlo**:
  - `/admin/configuracion` (sección Centro) con `admin`: campo "Correo para
    respuestas".
  - En Mailpit, un correo de confirmación muestra `Reply-To`.
- **Pruebas**:
  - Unitario del proveedor de correo.
  - Integración de la configuración.
  - Caso nuevo en `seguridad_bd.sql` si se agrega columna.
  - Playwright de Configuración.
- **Aprobación**: el Reply-To llega en Mailpit; Traefik rechaza TLS 1.0 y
  1.1 (se valida al desplegar; en local solo la configuración).

### E1.3 Pasarela solo con modelo CENTRO

- **Cambia**: regla en BD (CHECK o trigger, según cómo se habilite hoy
  `medios_pago_habilitados`) más el mensaje 422. Sección "Pasarela por
  cobrador" en `integraciones.md`.
- **Dónde verlo**: `/admin/configuracion` (Reglas o Cobros) con `admin`,
  modelo DIRECTO: PASARELA aparece deshabilitada con la explicación.
- **Pruebas**:
  - Caso nuevo en `seguridad_bd.sql`.
  - Integración (422).
  - Test del componente de configuración.
- **Aprobación**: con DIRECTO no se puede activar PASARELA, y con CENTRO
  sigue igual.

### E1.4 Comprobante de pago y boleta SII (D9)

- **Decisión previa** (se pide al aprobar la fase): ¿el renombre llega a BD
  y API (migración nueva que renombra `boletas` a `comprobantes_pago`,
  evento, DTO y cliente regenerado), o solo a los textos? Recomendado: BD y
  API, para que el código no siga diciendo "boleta" a algo que no lo es.
- **Cambia**:
  - Comprobante de pago: lo que hoy es `boletas`, con su número interno y la
    leyenda "Documento no tributario".
  - Registro de documento tributario, tabla nueva (categoría A, emisor
    cifrado), con folio, tipo (`BOLETA_HONORARIOS` /
    `BOLETA_ELECTRONICA` / `OTRO`, TRI-04), emisor, fecha, monto y
    cita/pago. Lo registra quien cobra: centro o profesional en DIRECTO.
  - Plantillas de correo y bandeja.
- **Dónde verlo**:
  - `/portal/pagos` con `paciente`: "Comprobante de pago" y, si existe,
    "Boleta SII folio N".
  - `/admin/cobros` con `gestion` y `profesional1`: "Registrar boleta
    emitida" en la cita pagada.
- **Pruebas**:
  - `seguridad_bd.sql` (por rol).
  - Integración por rol.
  - Vitest de los componentes de cobros.
  - Playwright de Cobros y del portal.
  - `npx impeccable detect` de las vistas tocadas.
- **Aprobación**: no queda la palabra "boleta" para el comprobante en UI,
  correos ni API, y el registro SII funciona con su matriz.

### E1.5 Trazabilidad (CENS-S3, ARCOP-03)

- **Cambia**:
  - Acciones `DESCARGA` y `EXPORTACION` en `accesos_ficha`.
  - La copia del tratante pasa a `DESCARGA`.
  - Se auditan los PDF de Cobros (reporte y liquidación).
  - La edición de datos del paciente queda registrada (campo, quién, cuándo
    y rol; sin el valor en claro).
- **Dónde verlo**: hoy ADMIN no tiene una vista de `accesos_ficha`. Se
  propone una vista "Auditoría de accesos" en `/admin/configuracion` (solo
  ADMIN, filtros por paciente, usuario y acción). Sirve además como
  evidencia para CENS.
- **Pruebas**:
  - `seguridad_bd.sql`.
  - Integración (cada descarga y edición deja su fila).
  - Playwright de la vista.
- **Aprobación**: cada acción del punto aparece en la vista con usuario, rol
  activo y fecha.

---

## Fase 2 - Soporte, legal en el silo, derechos y continuidad (P1 y P2)

### E2.1 Acceso de soporte (LEG-03, C1, D5)

- **Cambia**:
  - Rol de BD `soporte`, sin SELECT sobre tablas A con datos personales o
    clínicos. Solo usa funciones C de diagnóstico: conteos, estado de jobs,
    configuración, salud y errores sin datos.
  - Tabla `autorizaciones_soporte`: la otorga ADMIN con motivo, alcance
    (diagnóstico, configuración) y vencimiento.
  - Registro append-only de cada sesión de soporte, visible para ADMIN.
  - Runbook de emergencia: si un fallo exige tocar datos, lo hace el centro
    con su ADMIN guiado por el soporte, nunca el soporte.
- **Dónde verlo**: `/admin/configuracion` con `admin`, sección "Soporte":
  otorgar, revocar y ver el historial.
- **Pruebas**:
  - `seguridad_bd.sql`: como `soporte`, `pacientes` y `evoluciones` dan
    42501 y las funciones C devuelven solo agregados.
  - Integración.
  - Playwright.
- **Aprobación**: un caso de BD demuestra que `soporte` no lee ningún dato
  personal ni clínico, ni siquiera cifrado.

### E2.2 Términos de servicio y DPA en el silo (LEG-06, LEG-01, D6)

- **Cambia**:
  - Tipos `TERMINOS_SERVICIO` y `DPA` en `politicas` (versionados por silo).
  - Aceptación por un usuario ADMIN, con versión, fecha y usuario.
    `aceptaciones_politica` hoy apunta a paciente, así que se agrega
    `usuario_id` o una tabla aparte.
  - Mientras no se acepte la versión vigente, el ADMIN ve un aviso
    bloqueante al ingresar.
  - Plantillas base de los textos, con la cláusula de no uso propio y la
    lista de subencargados.
- **Dónde verlo**:
  - `/admin/configuracion` > Políticas.
  - Al ingresar con `admin` tras publicar una versión nueva aparece la
    aceptación.
- **Pruebas**: `seguridad_bd.sql`, integración y Playwright.
- **Aprobación**: queda registro de versión, fecha y ADMIN que aceptó. Los
  textos los revisa asesoría legal fuera del sistema.

### E2.3 Derechos de los titulares (ARCOP-01, 04, 05, 06, 07, 08; COM-04)

Se divide en tres entregas para poder revisar cada una.

**E2.3a Registro y plazo (ARCOP-01, D1)**
- **Cambia**:
  - Tabla `solicitudes_derechos`: tipo, titular, canal, estado, recibida y
    vence.
  - Cálculo en días hábiles con una tabla `feriados` que mantiene el
    operador y que la migración trae cargada con el año en curso.
  - Alerta interna antes del vencimiento.
- **Dónde verlo**: `/admin/fichas` (o una sección nueva "Solicitudes de
  datos") con `admin`: lista con días restantes.
- **Aprobación**: el vencimiento salta fines de semana y feriados; la
  alerta aparece.

**E2.3b Solicitud sin cuenta por RUT (ARCOP-08, D2)**
- **Cambia**:
  - Formulario público: RUT y tipo de derecho. La respuesta en pantalla es
    siempre la misma, para no revelar si el RUT existe.
  - Si el RUT existe, se crea la solicitud y se avisa al correo registrado
    del paciente, nunca a un correo nuevo.
  - Verificar que la invitación a crear cuenta salga una sola vez.
- **Dónde verlo**: ruta pública nueva (p. ej. `/derechos`) sin sesión; la
  solicitud aparece en E2.3a y el aviso llega a Mailpit.
- **Aprobación**: con un RUT inexistente la respuesta es igual y no se envía
  nada.

**E2.3c Bloqueo, cancelación, oposición y consentimientos (ARCOP-04, 05,
06, 07; COM-04; D3)**
- **Cambia**:
  - Bloqueo: marca en el paciente con motivo y solicitud. Mientras dure, la
    BD rechaza toda gestión sobre ese paciente (citas, edición, mensajes,
    envíos no legales) y todas las vistas muestran "Tratamiento bloqueado
    por solicitud del titular".
  - Cancelación periférica: función que vacía contacto, preferencias,
    respuestas del match y cuenta del portal, conserva la ficha y muestra el
    motivo legal.
  - Preferencias por canal (correo y WhatsApp) y consentimiento de
    comunicaciones por canal, desmarcado, al reservar y en el portal.
- **Dónde verlo**:
  - `/admin/fichas/[id]` con `admin`: aplicar el bloqueo y ver el aviso en
    la ficha (`profesional1`), la agenda y Cobros.
  - `/pedir-hora` y `/portal/avisos`: casillas por canal desmarcadas.
- **Pruebas**:
  - `seguridad_bd.sql`: un bloqueo rechaza cada escritura.
  - Integración.
  - Vitest de las casillas desmarcadas.
  - Playwright.
- **Aprobación**: con el bloqueo, ningún rol puede hacer gestiones sobre el
  paciente y el motivo se ve en todas sus vistas.

### E2.4 Respaldos, monitoreo y detección (CENS-S5, CENS-S1, BRE-03)

- **Cambia**:
  - Script de respaldo diario cifrado por silo con destino separado,
    retención definida y restauración verificada mensual
    (`verificar_respaldo.sh`, registrada en `eventos_llaves`).
  - RTO y RPO escritos.
  - Monitor externo de `/api/salud` con alerta al operador.
  - Job de detección sobre `accesos_ficha` (lecturas masivas, horario
    inusual) que crea una alerta interna.
  - Registro de intentos de login fallidos.
- **Dónde verlo**: runbook más un simulacro documentado; las alertas
  internas en el inicio del panel de `admin`.
- **Aprobación**: restauración probada y registrada; una lectura masiva de
  prueba genera la alerta.

---

## Fase 3 - Exportaciones (D7)

### E3.0 Propuesta de contenido (solo documento)

Antes de escribir código: `docs/cumplimiento/exportacion.md` con el
contenido propuesto para discutir.
- **Exportación por paciente** (ARCOP-02): datos personales, citas, pagos y
  comprobantes, consentimientos, documentos emitidos, ficha y evoluciones
  (solo si la solicitud lo cubre).
- **Exportación del centro** (LEG-04): todo lo anterior por paciente, más
  equipo, configuración y auditoría.
- **Formato**: JSON por entidad con esquema versionado, más PDF legible por
  ficha.
- **Seguridad**: quién la pide (ADMIN), cómo se entrega (archivo cifrado,
  contraseña por otro canal), registro `EXPORTACION` y vencimiento del
  enlace.

**Aprobación**: tú decides el contenido antes de E3.1.

### E3.1 Exportación por paciente / E3.2 Exportación del centro y baja del silo

Se implementan según lo aprobado en E3.0. E3.2 suma el runbook de baja:
exportación, acta de recepción, plazo y borrado de BD, volúmenes,
respaldos y llaves, y acta de eliminación.

---

## Fase 4 - Post-MVP (solo documentado, sin implementar)

| Tema | Qué queda listo antes | Cuándo |
|---|---|---|
| Pasarela real por cobrador (PAG-01, PAG-02) | Diseño en `integraciones.md` (E1.3) y categoría FINANCIERO | Tras el MVP |
| Proveedor de boletas electrónicas (TRI-01, TRI-03) | Registro manual de E1.4 como base | Tras el MVP |
| WhatsApp Business (COM-05, COM-06) | Consentimiento y preferencia por canal (E2.3c) | Al final, como extra |
| Integridad con hash encadenado (CENS-S2) | Append-only actual | Antes del sello CENS |
| Encabezado fijo del paciente y principios de usabilidad (CENS-U1, CENS-U2) | — | Antes del piloto o del sello |
| Métricas por centro y módulos extra (PRO-01, PRO-02) | — | Con el panel maestro |
| Checklist de alta de centro (PRO-03) | Enlaza lo de E1.1, E2.2 y E2.4 | Antes del piloto |
| Google (GOO-01) | — | Pospuesto |
| Vitrina en el landing de Vinculos (D8) | — | Tras cerrar el esqueleto de silos |

---

## Orden y dependencias

```
E0.1 -> E0.2
E1.1 -> E1.2 -> E1.3 -> E1.4 -> E1.5
E1.5 -> E2.1 -> E2.2
E2.2 -> E2.3a -> E2.3b
E2.3a -> E2.3c
E2.4 (independiente; puede ir en paralelo desde la Fase 1)
E2.3a + E1.5 -> E3.0 -> E3.1 -> E3.2
```

E1.5 va antes de E2.1 y E3 porque la auditoría de descargas y exportaciones
debe existir antes de exponer nuevas salidas de datos.

## Para confirmar al aprobar este roadmap

1. D2: entiendo que el titular sin cuenta se identifica por RUT y que la
   confirmación de la solicitud solo va al correo ya registrado. ¿Es así?
2. D3: "no se agregan más gestiones": ¿incluye cancelar citas futuras ya
   agendadas, o solo impedir nuevas?
3. E1.4: renombre en BD y API (recomendado) o solo en textos.
4. E1.5 y E2.3a: ¿apruebas las vistas nuevas de ADMIN ("Auditoría de
   accesos" y "Solicitudes de datos")? No están en el diseño de Claude
   Design: se construirían con `MASTER.md` y se correría `impeccable`.

## Respuestas a "Para confirmar" (2026-10-28)

1. Se reconoce que el paciente existe y se le indica que la informacion ira
   a su correo registrado, salvo que pida actualizarlo.
2. El bloqueo solo impide gestiones nuevas; lo ya agendado se mantiene.
3. El renombre llega a BD y API.
4. Vistas "Auditoria de accesos" y "Solicitudes de datos" aprobadas.

Aprobadas para ejecutar: Fase 1 y Fase 2.

## Estado

| Entrega | Estado |
|---|---|
| E1.1 Documentos | Hecha (2026-10-28) |
| E1.2 Correo y TLS | Hecha: Reply-To con el correo de contacto publico (sin columna nueva), configuration set de SES, TLS 1.2 minimo |
| E1.3 Pasarela solo del centro | Hecha (BD y API; no hay pantalla de medios de pago, pendiente desde 03b-3.1) |
| E1.4 Comprobante y boleta SII | Hecha (renombre en BD y API; registro manual del documento tributario) |
| E1.5 Trazabilidad | Hecha (DESCARGA, EXPORTACION, edicion de pacientes, registro_exportaciones, vista "Auditoria de accesos") |
| E2.1 Acceso de soporte | Hecha (rol sin tablas, autorizacion del ADMIN, registro; pestaña "Soporte"; runbook) |
| E2.2 Terminos y DPA en el silo | Hecha (publica el operador, acepta ADMIN, aviso bloqueante; plantillas borrador para revision legal) |
| E2.3a Registro y plazo | Hecha (30 dias habiles, alerta a 5 dias; pestaña "Solicitudes de datos"; feriados calculados por ley y pestaña "Feriados" para los puntuales) |
| E2.3b Solicitud sin cuenta por RUT | Hecha con la variante aprobada: misma respuesta exista o no el RUT; registro y aviso solo al correo registrado; el cambio de correo lo hace el centro tras verificar identidad. Pagina publica `/derechos` (enlace en el pie) |
| E2.3c Bloqueo, cancelacion, canales | Hecha (bloqueo visible e impide gestiones nuevas; cancelacion periferica; WhatsApp con consentimiento propio en Pedir hora y en el portal) |
| E2.4 Respaldos, monitoreo, deteccion | Hecha en codigo y scripts; RTO/RPO aprobados; `instalar.sh` listo para el servidor (falta servidor y bucket) |
| E0.1 Dependencias | Hecha: 0 vulnerabilidades de produccion en backend y frontend (`docs/seguridad/dependencias.md`) |
| E0.2 Proceso | Hecho: `npm run auditoria` (falla con alta o critica) y proceso escrito |
| E3.0 Propuesta de contenido | Hecha y aprobada (X1 tratante, X2 enlace + codigo, X3 clave del ADMIN, X4 JSON + PDF) |
| E3.1 Exportacion por paciente | Hecha (menores: menor de 14 sus adultos responsables, 14 a 17 ambos) |
| E3.2 Exportacion del centro y baja | Hecha (archivo cifrado con la clave del ADMIN, script de descifrado, runbook de baja) |

## Respuestas (2026-10-28, segunda ronda)

- Orden de ejecucion: Fase 0 primero (prioritaria), luego E2.3b y los pendientes.
- E2.3b: aprobada la variante segura (respuesta siempre igual; aviso solo al correo registrado; cambio de correo por el centro).
- Demas pendientes: aplicar las propuestas. RTO 4 h habiles y RPO 24 h aprobados; lo que requiere servidor, cuentas externas o asesoria legal queda preparado y anotado.
