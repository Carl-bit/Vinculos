# 03b-4.1: diseño vs implementación

Capturas a 1440 px con el seed demo (`npm run demo:reset`), 2026-10-21.

- `diseno/`: las vistas de `design-system/vinculos/Tenant/*.dc.html`
  renderizadas con los tokens de `frontend/src/app/globals.css` (el
  `_ds/organic-*/styles.css` que referencian no está en el repo).
- `app/`: la implementación (Playwright, ingreso real con el código de
  Mailpit).
- `comparadas/`: diseño a la izquierda, implementación a la derecha.

| Vista | Comparada | Usuario |
|---|---|---|
| Mi perfil (profesional) | `mi-perfil-profesional.png` | profesional1 |
| Mi perfil (cuenta madre, rol ADMIN activo) | `mi-perfil-admin.png` | admin |
| Agenda semana / mes | `agenda-semana.png`, `agenda-mes.png` (+ `app/agenda-viendo-a.png`) | admin |
| Dashboard | `dashboard-admin.png`, `dashboard-profesional.png` | admin, profesional1 |
| Cobros | `cobros.png` | admin |
| Configuración | `configuracion.png` | admin |
| Match configuración | `match-configuracion.png` | admin |
| Equipo (Perfil profesional) | `equipo.png` | admin |
| Fichas vista administrativa / del profesional | `fichas-administrativa.png`, `fichas-profesional.png` | admin, profesional1 |

## Diferencias que quedan y su motivo

| Vista | Diferencia | Motivo |
|---|---|---|
| Todas | Nombres, fotos, montos y conteos del diseño | Datos de ejemplo (brechas.md: no son requisitos); se muestran los del seed |
| Todas | Cargo bajo el nombre del usuario ("Directora") | Dato inexistente: se muestra el rol activo |
| Sidebar | "Mi perfil" y "Mensajes" en el menú; selector de equipo y de rol | Agregados (03b-1/03b-4): huecos del diseño resueltos en MASTER.md |
| Mi perfil | Nombre, teléfono y correo van en "Mi cuenta > Mis datos de contacto" y no en "Mis datos y descripción" | Son de la cuenta (`PATCH usuarios/yo`, el correo es el de ingreso y del código), no del perfil público; una sola barra "Guardar mi perfil" mezclaría dos permisos distintos |
| Mi perfil | Años de experiencia y registro profesional en solo lectura | Regla de la API: se derivan de la trayectoria verificada (brechas 2.8) |
| Mi perfil | Sin "Protocolo del centro" ni "Marcar como leído" | Fuera de la API (brechas 2.8, se propuso posponer) |
| Mi perfil | "Mis pacientes" sin "Por confirmar" | 03b-3.2 retiró la aprobación; estados: ficha sin cerrar, al día, alta |
| Mi perfil | Mi cuenta: "Verificación en dos pasos" y "Mis datos de contacto" de más; "Avisos y recordatorios" lleva a la bandeja (sin preferencias por canal del equipo) | Agregados de 03b-4.1; WhatsApp fuera de alcance |
| Mi perfil | Indicadores y próxima sesión solo con el rol clínico activo; con ADMIN activo se explica cómo cambiar | La API los entrega por rol activo (`reportes/dashboard`) |
| Mi perfil | Debajo: tipos de atención, trayectoria, tarifas, datos para pagos, sala y calendario | Lo que la API tiene y el diseño no (regla: agregar, no quitar) |
| Mi perfil | Sin barra inferior "Salir sin guardar" | Cada formulario guarda lo suyo; salir es navegar |
| Agenda | Control Semana \| Mes y "Hoy" en la cabecera; vista mensual | Pedido de 03b-4.1 (el diseño solo tiene semana) |
| Agenda | Sin "Reservando..." de otros | La API solo expone las retenciones propias (brechas 12) |
| Dashboard | "Uso de boxes" en vez de "Ocupación"; módulo "No contratado" con candado | Cálculo de la BD (horas apartadas); los módulos inactivos se ocultan (regla 03b) |
| Cobros | Sin "Cobro por derivación" (monto fijo o %) | La BD tiene un solo porcentaje del centro (C-10); se muestra "Comisión del centro" |
| Cobros | Sin "Ver cierre de sesión" | Reemplazado por "Registrar asistencia y pago" (C-11) |
| Equipo | Lista vertical de integrantes en vez de la tira de avatares | **Pendiente de diseño**: la tira no muestra estado (inactiva, practicante vencido) ni escala a 13 integrantes; queda por decidir si se adapta |
| Equipo | Sin "Rol dentro del centro" editable con pastillas | El rol se cambia en la cuenta (ADMIN) con sus reglas de BD (roles adicionales) |
| Fichas | Pestañas extra (borradores, derivaciones, accesos, plantillas, catálogos) | Funciones de 03b-5 que el diseño no tiene |

## Selector de equipo

`app/agenda-viendo-a.png`: con un integrante elegido aparece "Viendo a X"
(ver su perfil en Equipo o volver a todo el equipo). Agenda, pendientes,
horarios y cobros se filtran; ADMIN/GESTION nunca ven datos clínicos por
este selector (solo cambia el filtro, no el token).
