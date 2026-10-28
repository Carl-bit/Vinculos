# Baja de un centro: salida del servicio (AUD-01 E3.2, LEG-04)

Vinculos es Encargado: al terminar el servicio entrega al centro sus datos y
luego elimina la instancia. El centro (Responsable) sigue obligado a
conservar las fichas al menos 15 años desde la ultima atencion (Ley 20.584,
Decreto 41) con lo que recibe.

## 1. Exportacion (la hace el centro)

1. La cuenta madre (ADMIN) entra a Configuracion > Exportar datos, elige una
   clave de 16 o mas caracteres y descarga `exportacion-centro-AAAA-MM-DD.vxp`.
   - Contiene todas las tablas del silo salvo llaves, sesiones, tokens,
     codigos, intentos de ingreso y colas de correo; con las columnas
     cifradas ya legibles y un PDF por ficha clinica.
   - Va cifrado (AES-256-GCM, clave derivada con scrypt). Vinculos no guarda
     la clave ni el archivo: el operador nunca puede abrirlo (D5).
   - Queda en `registro_exportaciones` con su tamaño y huella SHA-256.
2. Vinculos entrega al centro `infra/scripts/exportacion/descifrar.mjs`. El
   centro lo abre en su equipo:

   ```sh
   CLAVE='<su clave>' node descifrar.mjs exportacion-centro-AAAA-MM-DD.vxp carpeta
   ```

   Resultado: `indice.json`, `datos/<tabla>.json` (una tabla por archivo) y
   `fichas/<paciente>.pdf`.
3. El centro verifica el contenido (conteos del `indice.json`) y firma el
   **acta de recepcion**: fecha, huella SHA-256 del archivo (la del registro),
   conteo de pacientes y fichas, y quien recibe.

La exportacion incluye las notas clinicas: es la entrega legal de las fichas
al Responsable. Debe pedirla y recibirla quien responde por ellas (direccion
del centro).

## 2. Eliminacion (la hace el operador)

Plazo: el acordado en el contrato; si no se acordo, 30 dias desde el acta de
recepcion. Antes de borrar, confirmar por escrito con el centro.

1. Detener el silo: `docker compose -f infra/docker-compose.yml --env-file infra/.env down`.
2. Borrar los volumenes del silo (`docker volume ls | grep erp-<slug>`;
   `docker volume rm ...`).
3. Borrar los respaldos: `infra/respaldos/<slug>/` en el host y el prefijo
   `<slug>/` del bucket (incluidas versiones, si el bucket las guarda).
4. Destruir las llaves: `infra/secrets/<slug>/` (`shred -u` de `kek` y
   `respaldo.key`) y avisar a los custodios de las partes de recuperacion
   que destruyan la suya.
5. Quitar el dominio de Traefik y del DNS; quitar el crontab del silo
   (`crontab -e`, lineas `# vinculos:<slug>`).
6. **Acta de eliminacion**: fecha, que se borro (BD, volumenes, respaldos,
   llaves) y quien lo hizo; copia al centro. Se guarda en el registro de
   Vinculos (fuera del silo).

## Pendiente

- Plazo de eliminacion por defecto (30 dias) a confirmar en los terminos de
  servicio de cada centro.
