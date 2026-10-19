# Pantallas de 03b-5 para revisión

Inventario de todo lo que se construyó o se completó en 03b-5 (5.1 clínico,
5.2 acceso a fichas ajenas y equipo, 5.3 cierre de flujos). Cuentas del seed
demo (`npm run demo:reset`, contraseña `dev-password`, TOTP en
`infra/local/totp-demo.txt`). Pasos de prueba en `docs/pruebas/guion_manual.md`
secciones 11, 12 y 13. Las capturas quedan fuera del repo (decisión del
usuario).

Paciente de ejemplo: "Paciente Prueba" (tratante: Profesional Uno). Practicante:
"Camila Demo Practicante" (supervisa Profesional Dos).

## 1. Ficha clínica (`/admin/fichas/<paciente>/ficha`)

Solo PROFESIONAL o PRACTICANTE con acceso (tratante o acceso temporal).
ADMIN y GESTION ven "La ficha clínica es del equipo tratante".

| # | Sección | Cuenta | Qué revisar |
|---|---|---|---|
| 1.1 | Evoluciones | `profesional1` | Línea de tiempo (más reciente arriba), plantilla con su versión, riesgo, corrección enlazada al original, aviso de riesgo medio/alto, borradores sin confirmar |
| 1.2 | Nueva evolución | `profesional1` | Sesión que cierra, plantilla, campos dinámicos, notas con aviso de texto libre, indicador "Borrador guardado", descartar |
| 1.3 | Confirmar en el expediente (modal) | `profesional1` | Tipo de sesión, nivel de riesgo, estado de avance, intervenciones; aviso de que no se edita |
| 1.4 | Corregir | `profesional1` | Registro nuevo con la versión del original; aviso de que no hay borrador |
| 1.5 | Ficha de ingreso | `profesional1` | Registro con su versión; registrar y corregir |
| 1.6 | Documentos | `profesional1` | Solicitudes de copia de la ficha; emitir con vista previa del PDF (Chrome real); ver PDF; enviar por enlace o adjunto; historial de envíos |
| 1.7 | Adjuntos | `profesional1` | Subir (solo PDF/PNG/JPEG por contenido), descargar |
| 1.8 | Accesos | `profesional1` | Vigentes y vencidos; otorgar (motivo, alcance, hasta) |
| 1.9 | Alta | `profesional1` | Registrar alta con confirmación; altas anteriores |
| 1.10 | Columna derecha | `profesional1` | Contacto de emergencia y adulto responsable; conversaciones del caso |
| 1.11 | Comentarios de supervisión | `practicante` (ficha de Camila) | Bajo cada evolución, lo que comentó el supervisor |

## 2. Fichas y Pacientes (`/admin/fichas?vista=...`)

| # | Vista | Cuentas | Qué revisar |
|---|---|---|---|
| 2.1 | `borradores` | `profesional1` | Pendientes de todas las fichas, "Continuar" abre el borrador |
| 2.2 | `derivaciones` | `profesional2` | Ofertas para ti (solo motivo, edad y tipo; aceptar o rechazar), bandeja de supervisión (proponer practicante) |
| 2.3 | `derivaciones` | `profesional1`, `admin` | Lista en curso o cerradas, detalle con candidatos; ADMIN define candidatos, vuelve a ofrecer, cancela |
| 2.4 | `accesos` | `admin`, `profesional1` | Accesos vigentes y vencidos; "Abrir ficha" para el que lo recibió |
| 2.5 | `consentimientos` | `admin`, `gestion`, `profesional2` | Consentimientos de practicante (enviar enlace, registrar firmado o retiro con respaldo, pedir uno nuevo) y avisos de cambio de supervisor |
| 2.6 | `plantillas` | `admin`, `profesional1` | Por especialidad y uso, historial de versiones; editor de campos con vista previa; publicar, desactivar, versión nueva |
| 2.7 | `catalogos` | `admin`, `profesional1` | Tipos de sesión (proponer, aprobar, rechazar, activar), intervenciones y estados de avance (desactivar), tipos de documento (formato con variables) |
| 2.8 | `retencion` | `admin` | "Revisar" (queda auditado), decisión conservar o purgar con motivo, historial |
| 2.9 | Detalle del paciente | `admin` | Panel de accesos temporales y de solicitudes de copia de la ficha |

## 3. Mensajes (`/admin/mensajes`, nuevo ítem del menú)

| # | Pestaña | Cuentas | Qué revisar |
|---|---|---|---|
| 3.1 | Equipo | `profesional1` | Conversaciones GENERAL y del caso, no leídos, "Leído por", retirar dentro de 5 minutos, agregar personas |
| 3.2 | Nueva conversación | `profesional1`, `admin` | Profesional: general o caso; ADMIN: solo general |
| 3.3 | De pacientes | `profesional1` | Mensajes del portal con teléfono y correo, marcar leído |
| 3.4 | Avisos | cualquiera | Bandeja propia con "Ir a resolverlo" |

## 4. Equipo y Agenda

| # | Pantalla | Cuentas | Qué revisar |
|---|---|---|---|
| 4.1 | Equipo › Supervisión | `profesional2` | Casos por código (sin nombres), evoluciones con solo los campos visibles, comentar |
| 4.2 | Equipo › integrante › Asignar tipos | `admin` | Reemplaza los tipos aprobados |
| 4.3 | Agenda › Horarios del equipo › Margen de traslado | `admin` | Margen propio o del centro, horas en conflicto, aviso en la tarjeta |
| 4.4 | Agenda › sesión pasada | `admin` | "Requerir cierre" |
| 4.5 | Agenda › Agendar sesión | `admin` | Verificación previa (alternativas si no se puede) y retomar la retención propia |
| 4.6 | `/admin/agenda?cita=<id>` | `admin` | Abre el detalle de la cita |

## 5. Sitio público, portal y configuración

| # | Pantalla | Cuenta | Qué revisar |
|---|---|---|---|
| 5.1 | `/match` › Prefiero filtrar yo mismo | sin sesión | Filtros y resultados con primera hora |
| 5.2 | `/equipo/<id>` › Reportar valoración | sin sesión | Motivo obligatorio, confirmación |
| 5.3 | Portal › Consentimientos | `paciente2` | Texto y versión vigentes del consentimiento de practicante |
| 5.4 | Configuración › Consentimiento y políticas | `admin` | Política nueva "Consentimiento de atención con practicante" |
| 5.5 | Panel en móvil | cualquiera del equipo | Barra con rol y botón de menú |

## 6. Para decidir

- impeccable marca "tarjeta dentro de tarjeta" en pantallas de 03b-4 que
  copian el diseño del handoff (tiles de horario en Agenda, datos del
  integrante en Equipo, texto de la política en Configuración, avisos en el
  detalle del paciente). La regla de 03_front lo prohíbe; el diseño lo tiene.
- Revocar un acceso temporal antes de su fecha: hoy la BD no lo permite.
- "Corregir" se ofrece solo al autor del registro (la BD lo permite a
  cualquier tratante con acceso).
