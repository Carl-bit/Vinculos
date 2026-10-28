# Subencargados del tratamiento (AUD-01, LEG-05)

Vinculos actua como **Encargado** del tratamiento; cada centro es el
**Responsable**. Esta lista alimenta el anexo de tratamiento de datos (DPA)
de cada centro (`TERMINOS_SERVICIO` / `DPA`, ver AUD-01 E2.2). Se actualiza
antes de incorporar un proveedor nuevo y el centro debe conocer el cambio
antes de que el proveedor trate sus datos.

| Proveedor | Servicio | Pais / region | Finalidad | Datos que trata | Estado |
|---|---|---|---|---|---|
| Amazon Web Services (Lightsail) | Servidor y disco del silo (contenedores de la API, el front y Postgres), respaldos | Region por definir al desplegar (anotar aqui la elegida) | Alojar la aplicacion y la BD de cada centro | Todos los datos del silo. Las columnas sensibles van cifradas por la aplicacion (`docs/seguridad/cifrado.md`); la KEK no se guarda en el respaldo | Previsto (destino de produccion) |
| Amazon Web Services (SES) | Envio de correo transaccional (SMTP) | Region por definir (anotar aqui la elegida) | Avisos al paciente y al equipo: confirmaciones, recordatorios, pagos, codigos de verificacion | Direccion de destino, nombre visible del centro, asunto y cuerpo de la plantilla (sin contenido clinico: CHECK `plantillas_mensaje_variables_permitidas`; documentos solo por enlace con sesion) | Previsto (`docs/api/correo_ses.md`) |
| Let's Encrypt (ISRG) | Certificados TLS | Estados Unidos | Emitir los certificados HTTPS de cada dominio | Solo el nombre de dominio del silo; ningun dato de pacientes | En uso (`infra/traefik/docker-compose.yml`) |
| Pasarela de pago (por definir, cuenta propia del centro o del profesional) | Checkout de pago | Por definir | Cobrar la sesion en la pagina de la pasarela | Monto y referencia de la cita; nombre, correo o RUT solo si el proveedor lo exige (`core/integraciones/pasarela.ts`). Nunca datos de tarjeta en Vinculos | Post-MVP. Con conexion directa la pasarela contrata con el centro o el profesional, no con Vinculos: confirmar con asesoria si figura como subencargado de Vinculos o como proveedor directo del centro |
| Proveedor de boletas electronicas (por definir) | Emision de documentos tributarios | Por definir | Emitir boletas del centro o de honorarios del profesional | Datos del emisor y del receptor que exija el SII | Post-MVP (hoy el folio se registra a mano, AUD-01 E1.4) |
| Meta (WhatsApp Business, cuenta del centro) | Mensajeria | Por definir | Avisos por WhatsApp con consentimiento propio del canal | Telefono y plantilla de utilidad | Post-MVP, extra |

No se usan: Cloudflare (no hay tunel ni CDN configurado), analitica de
terceros (ni en el front publico ni en el panel), proveedores de IA,
agregadores de logs externos. Si alguno se incorpora, entra a esta tabla
antes de procesar datos.

## Datos que nunca salen del silo

- Ningun dato de pacientes se usa para fines propios de Vinculos
  (analitica entre centros, entrenamiento de modelos, marketing). Las
  metricas de uso futuras (PRO-02) seran agregados sin datos personales.
- El soporte del proveedor no lee datos personales ni clinicos (AUD-01
  E2.1).
