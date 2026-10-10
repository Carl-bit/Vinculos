# Modulos (bounded contexts)

Una carpeta por contexto. Cada modulo: `<modulo>.module.ts`, controladores,
servicios y `dto/`. Los servicios usan `ContextoBd.tx()` (transaccion con
contexto RLS), nunca el cliente global.

| Carpeta | Contexto | Prompt | Depende de |
| --- | --- | --- | --- |
| `nucleo/` | Usuarios, configuracion, accesos de practicantes, bajas, alertas, directorio | 02b | core |
| `fichas/` | Pacientes, adultos responsables, fichas, evoluciones, tipos de sesion, retencion | 02c | core |
| `agenda/` | Espacios, disponibilidad, bloqueos, soft-locks, citas, enlace online | 02d | core |
| `equipo/` | Perfil, trayectoria, datos privados, tarifas, tipos de atencion, supervision | 02e | core |
| `derivaciones/` | Derivaciones, consentimientos, avisos de cambio de supervisor | 02f | core |
| `match/` | Perfiles publicos, match, portal del paciente, mensajes, epicrisis | 02g | core (Equipo y Agenda solo via funciones de la BD) |
| `cobros/` | Pagos, boletas, arriendos (pendiente: 02h espera la definicion de "pago pendiente") | 02h | core |

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
