# Modulos (bounded contexts)

Una carpeta por contexto. Cada modulo: `<modulo>.module.ts`, controladores,
servicios y `dto/`. Los servicios usan `ContextoBd.tx()` (transaccion con
contexto RLS), nunca el cliente global.

| Carpeta | Contexto | Prompt | Depende de |
| --- | --- | --- | --- |
| `nucleo/` | Usuarios, configuracion, accesos de practicantes, bajas, alertas, directorio | 02b | core |
| `fichas/` | Pacientes, adultos responsables, fichas, evoluciones, tipos de sesion, retencion, documentos clinicos (texto + PDF, 02h/02i), adjuntos de la ficha (multipart, 02i) | 02c, 02h, 02i | core |
| `agenda/` | Espacios, disponibilidad, bloqueos, soft-locks, citas, enlace online, sala de videollamada y feed iCal (02h), recordatorios con token (02i) | 02d, 02h, 02i | core (videollamada y calendario: interfaces de core) |
| `equipo/` | Perfil, trayectoria, datos privados, tarifas, tipos de atencion (propone el profesional, aprueba ADMIN), supervision | 02e, 02h | core |
| `derivaciones/` | Derivaciones, consentimientos, avisos de cambio de supervisor | 02f | core |
| `match/` | Perfiles publicos, match, portal del paciente, mensajes, epicrisis | 02g | core (Equipo y Agenda solo via funciones de la BD) |
| `cobros/` | Estado de pago, pagos, boletas, politica de cancelacion, arriendos, liquidaciones | 02h | core (Agenda solo via la BD: `citas.monto`, `estado_pago_citas`) |

## Reglas

- Un modulo **nunca** importa el service de otro modulo. El cruce se hace con
  eventos de dominio (`core/eventos`, emitidos despues del COMMIT) o pasando
  por el nucleo (core).
- Todo endpoint: DTO con `class-validator` y `@Roles(...)` segun
  `docs/seguridad/matriz_permisos.md` (sin `@Roles` el guard rechaza).
- Escrituras con reglas de estado: solo funciones `SECURITY DEFINER`.
- Campos de `registro.ts`: se escriben con `claro()` y se leen con `texto()`;
  ids de esas filas los genera la API (`randomUUID`).
- Nombres de otros usuarios: solo `directorio_interno`, `mi_equipo_tratante`
  o `perfiles_publicos`; nunca `include` de `Usuario`.
