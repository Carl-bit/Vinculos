# Jerarquia de componentes (obligatoria, tambien en sesiones futuras)

Direccion de los imports, en un solo sentido:

```
ui/  ->  shared/  ->  <modulo>/  ->  app/(publico) | app/(admin)
```

| Carpeta                 | Que va aca                                                                      | Que NO va                                  |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| `ui/`                   | Primitivos puros: Button, Input, Badge, Modal, Card base                          | logica de negocio, fetch, nada de dominio  |
| `shared/`               | Compuestos que ya asumen el dominio: LayoutPublico, LayoutAdmin, AvatarProfesional | organismos de un solo modulo               |
| `agenda/`               | AgendaCalendar, SelectorHorario (libre / bloqueado por mi / por otro / confirmado) | imports desde otro `<modulo>/`             |
| `pacientes/`            | FormularioPaciente, FichaClinicaTimeline                                          | idem                                       |
| `equipo/`               | Gestion de profesionales y practicantes                                           | idem                                       |
| `match/`                | MatchWizard, resultados rankeados                                                 | idem                                       |
| `cobros/`               | Arriendos, pagos, emision de boleta                                               | idem                                       |

Reglas:

- Un `<modulo>/` **nunca** importa de otro `<modulo>/`. Si dos modulos necesitan
  lo mismo, sube a `shared/`; nunca se duplica.
- Antes de crear un componente, revisar si `ui/` o `shared/` ya tienen el
  equivalente.
- Las paginas en `app/` solo componen piezas de `<modulo>/` y `shared/`; no
  definen estilos sueltos ahi.
- Los primitivos de `ui/` salen del handoff de Claude Design o de
  `design-system/vinculos/MASTER.md`. No se reinventan modulo a modulo.
- El frontend no replica reglas de negocio del backend (RLS, EXCLUDE,
  validacion de menores): refleja el estado que el backend entrega.
