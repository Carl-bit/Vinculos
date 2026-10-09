# Consentimiento para atencion con practicante supervisado

## Principio: el paciente primero

El objetivo principal es el paciente. **Se consiente quien atiende; se
informa quien supervisa.**

- El paciente (o su adulto responsable si es menor) consiente ser atendido
  por **el practicante X bajo supervision de un profesional del centro**.
- El supervisor siempre existe: `cambiar_supervisor()` cierra la supervision
  vigente y abre la nueva en la misma transaccion. No se puede dar de baja a
  un profesional que supervisa practicantes activos sin cambiarlo antes.
- Cambiar de supervisor **no afecta las sesiones**: solo cambia quien evalua
  al practicante. El consentimiento sigue vigente y el practicante sigue
  atendiendo.
- Cambiar de practicante si requiere un consentimiento nuevo (otra persona
  atiende).

## Flujos

| Evento | Que pasa |
|---|---|
| Practicante acepta una derivacion | Derivacion ESPERANDO_CONSENTIMIENTO + solicitud (vence en `plazo_consentimiento_horas`, 48). ACEPTADO concreta el traspaso; RECHAZADO o vencido pasa al siguiente candidato. |
| Cambio de supervisor | Un aviso (`avisos_consentimiento`, tipo CAMBIO_SUPERVISOR) por paciente con consentimiento vigente, con plazo de oposicion (`plazo_oposicion_horas`, 48). El nuevo supervisor accede a los datos seudonimizados desde que asume; el anterior deja de acceder. Sus comentarios quedan en el registro del paciente (los lee el tratante). |
| Aviso: CONFORME | Queda registrado (quien respondio, como, respaldo). |
| Aviso: OPOSICION | Revocacion: el practicante pierde acceso al instante, sus citas futuras con el paciente quedan POR_REPROGRAMAR y el paciente entra a `pacientes_por_reasignar()` (motivo CONSENTIMIENTO). |
| Aviso sin respuesta al vencer | CONFORME tacito (job `cerrar_avisos_vencidos`, sin `respondido_por`). |
| Revocacion directa | `revocar_consentimiento()`, mismos efectos que la oposicion. |

**Quien responde o revoca**: el PACIENTE desde el portal; si es menor, en
nombre de un adulto responsable suyo (`otorgado_por_tipo = ADULTO_RESPONSABLE`
+ `adulto_responsable_id`); o ADMIN/GESTION con respaldo documental
(`respaldo_documento_ref`). El supervisor solicita, pero nunca registra.

## Validacion legal pendiente

El modelo "se consiente quien atiende, se informa quien supervisa" (con aviso,
plazo de oposicion y conformidad tacita) **debe validarse con asesoria legal**
antes de usarse con pacientes reales, en particular frente a:

- Ley 21.719 (proteccion de datos personales): base de licitud del
  tratamiento por el nuevo supervisor, deber de informacion y si la
  conformidad tacita es suficiente para datos de salud (datos sensibles).
- Ley 20.584 (derechos y deberes del paciente): consentimiento informado y
  acceso a la ficha clinica por terceros.

Mientras no se valide, los plazos (`plazo_oposicion_horas`) y la conformidad
tacita son configuracion del centro, no una conclusion juridica.
