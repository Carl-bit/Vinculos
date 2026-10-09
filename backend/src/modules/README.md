# Modulos (bounded contexts)

Una carpeta por bounded context. Cada modulo contiene como minimo
`<modulo>.module.ts`, `<modulo>.controller.ts`, `<modulo>.service.ts` y `dto/`.

| Carpeta              | Bounded context      | Depende de                                  |
| -------------------- | -------------------- | ------------------------------------------- |
| `nucleo/`            | Usuarios, roles, RLS | nada                                        |
| `fichas-pacientes/`  | Fichas y Pacientes   | Nucleo                                      |
| `agenda-espacios/`   | Agenda y Espacios    | Nucleo                                      |
| `equipo/`            | Equipo (RRHH)        | Nucleo                                      |
| `match-terapeutico/` | Match Terapeutico    | Equipo (req.), Agenda y Espacios (opcional) |
| `cobros/`            | Cobros               | Agenda y Espacios (req.), Match (opcional)  |

## Reglas

- Un modulo **nunca** importa el service de otro modulo. El cruce se hace con
  eventos de dominio (`EventEmitter2`, contratos en `src/core/eventos/`) o
  pasando por el nucleo.
- "Depende de" en la tabla es dependencia de **dominio** (orden de sprints), no
  licencia para un import directo.
- Todo endpoint lleva DTO con `class-validator`. Sin excepciones.
- Todo endpoint que toque `pacientes`, `fichas_clinicas` o `evoluciones` pasa
  por el `RlsInterceptor` de `src/core/rls/`.

El contenido de estos modulos lo genera los prompts 02a-02h (`prompts/00_index.md`).
