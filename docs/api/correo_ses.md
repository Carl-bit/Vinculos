# Correo transaccional con Amazon SES (AUD-01, COM-01)

La API envia por SMTP generico (`ProveedorCorreoSmtp`,
`backend/src/core/notificaciones/correo.ts`). En produccion el SMTP es el de
Amazon SES. No hay codigo especifico de SES: todo es configuracion.

## Remitente

- Direccion de la plataforma (`CORREO_REMITENTE`, p. ej.
  `no-responder@vinculos.cl`) con el **nombre del centro** como nombre
  visible (`configuracion_centro.nombre_centro`).
- **Reply-To**: el correo de respuestas del centro
  (`configuracion_centro.correo_respuesta`, lo edita ADMIN; AUD-01 E1.2).
  Asi el paciente que responde le escribe al centro, no a la plataforma.
  Sin ese campo, el correo sale sin Reply-To.

## Puesta en marcha (una vez para la plataforma)

1. **Region**: elegir una region de SES y anotarla en
   `docs/cumplimiento/subencargados.md`.
2. **Verificar el dominio** de la plataforma (identidad de dominio, no de
   direccion) en SES.
3. **DKIM**: activar Easy DKIM (2048 bits) y publicar los 3 CNAME que entrega
   SES en el DNS del dominio.
4. **SPF**: usar un dominio MAIL FROM propio (p. ej. `correo.vinculos.cl`)
   y publicar el MX y el TXT `v=spf1 include:amazonses.com ~all` que indica
   SES. Asi SPF se alinea con el dominio del remitente.
5. **DMARC**: publicar `_dmarc.vinculos.cl` con `v=DMARC1; p=none;
   rua=mailto:<buzon de reportes>` al inicio; pasar a `p=quarantine` cuando
   los reportes muestren que todo lo legitimo pasa DKIM y SPF alineados.
6. **Salir del sandbox** de SES (solicitud a AWS con el caso de uso:
   correo transaccional de centros de salud, sin marketing).
7. **Credenciales SMTP**: crear un usuario IAM solo para SMTP de SES y
   armar `SMTP_URL=smtps://<usuario>:<clave>@email-smtp.<region>.amazonaws.com:465`.
   Va en el `.env` del silo (nunca en git) y en ningun log.

## Separacion por silo

Una sola cuenta de SES sirve a todos los centros (subencargado comun), pero
cada silo usa su propio **conjunto de configuracion** (configuration set)
para que metricas, rebotes y quejas queden separados:

- Crear un configuration set por silo, con el nombre `CLIENTE_SLUG`, y
  ponerlo en `SES_CONFIGURATION_SET` del `.env` del silo. La API lo envia en
  la cabecera `X-SES-CONFIGURATION-SET` de cada correo (vacio = sin
  cabecera: se usa el configuration set por defecto de la identidad).

## Rebotes y quejas

- Activar el destino de eventos del configuration set (SNS o CloudWatch)
  para `Bounce` y `Complaint`.
- Hoy la API no los procesa: un rebote solo deja la fila de la
  notificacion como ENVIADO (SMTP acepto). Pendiente para despues del MVP:
  marcar el correo del paciente como invalido y avisar al centro.

## Contenido

- Nunca contenido clinico: las plantillas solo aceptan nombre, fecha, hora,
  modalidad, enlace y centro (CHECK `plantillas_mensaje_variables_permitidas`).
- Documentos clinicos solo por enlace que exige iniciar sesion.
- Sin marketing: SES se solicita para correo transaccional.

## Futuro: dominio propio por centro

Ver `docs/api/integraciones.md`, "Remitente": requiere que el centro
publique SPF, DKIM y DMARC para su dominio y verificarlo en SES.
