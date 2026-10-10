# Indice de prompts - Vinculos ERP

Una sesion de Claude Code por prompt, en este orden. CLAUDE.md se lee
siempre primero, en cada sesion, antes del prompt de turno. Estado de la BD:
`docs/bd/estado_fase_bd.md`.

## Back: base de datos (aplicados)
| Prompt | Migracion | Contenido |
|---|---|---|
| `01_bd.md` | `20261005000000_init`, `20261005000100_reglas_dominio` | Schema de las 5 areas, EXCLUDE de agenda, RLS inicial, seed |
| 01b | `20261006000000_endurecimiento_rls` | app_user LOGIN sin privilegios, FORCE RLS, acceso vigente, auditoria |
| 01c | `20261007000000_roles_y_rls_completa` | GESTION/PACIENTE, RLS completa, derivaciones con oferta secuencial |
| 01d | `20261008000000_directorio_practicantes_bajas` | Directorio, supervision, consentimiento, bajas, RLS restante |
| 01e | `20261009000000_cifrado_perfil_agenda_consentimiento` | Cifrado y llaves, perfil, cobro, agenda por modalidad |
| 01f | `20261010000000_ajustes_supervision_agenda` | Cambio de supervisor, gracia, tipos de sesion, minutos, retencion, margen |
| 01g | `20261011000000_cierre_fase_bd` | Cierre de fase: ajustes finales, reglas de API, commit |

01b a 01g se entregaron como prompts en la conversacion (no hay archivo);
su resultado esta en las migraciones, `docs/seguridad/` y `docs/bd/`.

## Back: API
Prompts entregados en la conversacion (sin archivo), en este orden. Cada uno
respeta la seccion "API" de CLAUDE.md y `docs/seguridad/requisitos_02_apis.md`.
Estado: `docs/api/estado_fase_api.md`.

| Prompt | Estado | Migracion | Contenido |
|---|---|---|---|
| 02a | hecho | `20261012000000_api_sesiones_alertas` | Config, contexto RLS por request, CryptoModule, auth (refresh rotativo), errores, logs, jobs, salud |
| 02b | hecho | — | Nucleo: usuarios, configuracion, accesos de practicantes, bajas, alertas, directorio |
| 02c | hecho | — | Fichas y pacientes: RUT con indice ciego, adultos responsables, evoluciones, tipos de sesion, auditoria, retencion |
| 02d | hecho | — | Agenda y espacios: disponibilidad, bloqueos, soft-locks, citas con verificacion previa, enlace online; script k6 |
| 02e | hecho | — | Equipo: perfil, trayectoria, datos privados, tarifas, supervision seudonimizada, recalculo de rut_hmac |
| 02f | hecho | `20261013000000_notificaciones` | Derivaciones, consentimientos, avisos, notificaciones |
| 02g | hecho | `20261014000000_portal_mensajes_epicrisis` | Match, portal del paciente, mensajes, epicrisis |
| 02h | propuesta | — | Cobros: espera confirmacion de `docs/api/propuesta_02h_cobros.md` |

`02_apis.md` (sin trackear) es una version anterior de la division; la
vigente es la de esta tabla.

`archivo/02_apis_original.md`: prompt original de API, obsoleto (anterior a
01b: no conoce app_user, RLS completa, cifrado ni funciones de BD).

## Pruebas (back)
- `04_pruebas.md` - integracion (Jest/Supertest), estres (k6) enfocado en
  la colision de reservas sobre el EXCLUDE constraint, y simulacion de
  los limites reales de Lightsail con Docker. Correrlo durante 02, antes de 03.

## Front
- `03_front.md` - portal publico + backoffice completo (Next.js):
  jerarquia de componentes, vistas segun el handoff de Claude Design.
  Depende de 02 (consume los endpoints ya generados).

## Reglas transversales (definidas una vez en CLAUDE.md, no repetir en cada prompt)
- Arquitectura: monolito modular, single-tenant, DDD, orden de modulos.
- Diseño: fuente de verdad = handoff de Claude Design (Centro Ejemplo),
  persistido en `design-system/vinculos/MASTER.md`, auditado con
  `impeccable detect`.
- Componentes: jerarquia `ui/` -> `shared/` -> `<modulo>/` -> paginas,
  obligatoria para toda vista nueva, incluidas sesiones futuras.

## Al agregar un modulo nuevo mas adelante
Sumar un prompt `0N_<modulo>.md` en `prompts/` con el mismo formato: tarea,
restricciones que no se pueden dejar pendientes, salida esperada. No crear
una jerarquia de componentes nueva ni redefinir reglas ya fijadas en
CLAUDE.md, solo referenciarlas. Agregar la fila a este indice en el orden de
dependencia real.
