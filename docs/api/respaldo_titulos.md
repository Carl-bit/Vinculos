# Respaldo de titulos como archivo (2026-11-07)

Documento del proceso completo: que se decidio, por que, como quedo en cada
capa (BD, API, front), como se probo y que queda abierto. Origen: decision
pendiente de la fase "Mi perfil y Mi cuenta segun diseño" (el diseño de
Perfil > Formacion pide subir un respaldo; la API solo recibia un enlace).

## 1. Problema

- `profesional_trayectoria.documento_respaldo_url` guardaba un enlace https
  a la nube del profesional. El documento quedaba fuera del sistema: el
  enlace podia caerse, quedar publico o cambiar de contenido despues de que
  el centro lo verifico, y el centro no conservaba evidencia de lo revisado.
- La pantalla exigia el enlace, pero la API no: un titulo se podia crear y
  verificar sin respaldo llamando a la API directamente.

## 2. Decisiones (aprobadas por el usuario)

| Pregunta | Decision |
|---|---|
| ¿El archivo es obligatorio? | Se puede crear el titulo sin archivo (por ejemplo, si la subida falla), pero **el ADMIN no puede verificarlo** sin al menos un respaldo. La pantalla pide el archivo al agregar un titulo. |
| ¿Enlace o archivo? | **Se reemplaza el enlace.** La API ya no lo recibe (enviarlo da 400) ni cuenta para verificar. Los enlaces existentes quedan como dato historico (columna sin cambios, se muestra "hay un enlace anterior, que ya no cuenta"). |
| ¿Que pasa con el archivo? | **Sin borrado suelto.** Subir otro archivo crea una version nueva y conserva las anteriores. |
| ¿Y cuando el profesional se va? | Ver 2.1. |

### 2.1 Contradiccion resuelta a favor de la BD

La recomendacion original decia "conservar el archivo cuando el profesional
se va, sin borrado fisico, igual que su historial". Choca con una regla ya
vigente de la BD: `cerrar_cuenta()` (migracion 20261009000000) borra perfil,
trayectoria, datos privados y tarifas porque "del profesional no se retiene
nada como persona"; lo que exige la ley (Decreto 41 / Ley 20.584) sobrevive
en la copia de autoria cifrada de las evoluciones, no en la trayectoria.

Como manda la BD (CLAUDE.md), quedo asi:

- **Mientras la cuenta exista** (activa, desactivada o en baja con su
  periodo de gracia) los respaldos se conservan y nadie los borra.
- **Al cerrar la cuenta** (`cerrar_cuenta`, tras `dias_gracia_cierre`) se
  borran junto con la trayectoria (`ON DELETE CASCADE`). Lo mismo si el
  propio profesional elimina el titulo: sin titulo publicado no hay
  afirmacion que respaldar.

Si el centro necesita conservar la evidencia por mas tiempo (por ejemplo,
para una fiscalizacion de la Superintendencia), es una decision legal: habria
que cambiar `cerrar_cuenta` y documentar el plazo en
`docs/seguridad/retencion_datos.md`. No se implemento.

## 3. Base de datos

Migracion `backend/prisma/migrations/20261107000000_respaldos_trayectoria`.

- Tabla nueva `trayectoria_respaldos`, **Categoria A** (identifica al
  profesional; la recomendacion inicial decia B, pero B es "sin datos
  personales": se corrigio).
  - `id` lo genera la API (va en el AAD del cifrado); `trayectoria_id`
    (FK CASCADE), `profesional_id`, `nombre_archivo`, `tipo_mime`,
    `tamano_bytes`, `contenido` (bytea cifrado), `subido_en`.
  - CHECK `trayectoria_respaldos_archivo`: nombre no vacio de hasta 200,
    tipo PDF/PNG/JPEG, tamaño > 0 y contenido >= 49 bytes (formato cifrado).
  - ENABLE + FORCE RLS. `trayectoria_respaldos_select`: el propio y
    ADMIN/GESTION. `trayectoria_respaldos_acceso_vigente` RESTRICTIVE.
  - GRANT solo SELECT a `app_user`: sin INSERT, UPDATE ni DELETE directos.
- Funcion `subir_respaldo_trayectoria(id, trayectoria, nombre, tipo, tamano,
  contenido)` (SECURITY DEFINER): solo PROFESIONAL/PRACTICANTE dueño del
  titulo (otro -> P0002, otro rol -> 42501); inserta la version y deja el
  titulo en revision (`verificado = false`).
- `proteger_trayectoria()` (trigger existente) suma la regla: ADMIN pasando
  `verificado` a true sin respaldo -> 23514 con restriccion
  `trayectoria_verificar_con_respaldo`.
- Cifrado: `trayectoria_respaldos.contenido`, DEK **IDENTIFICACION**, AAD
  `trayectoria_respaldos:contenido:<id>`, archivo en base64. Registrado en
  `backend/src/common/crypto/registro.ts` y en `docs/seguridad/cifrado.md`.

## 4. API

| Ruta | Roles | Respuesta |
|---|---|---|
| `POST /api/trayectoria/:id/respaldos` (multipart, campo `archivo`) | PROFESIONAL, PRACTICANTE | `TrayectoriaVista` con `respaldos`; 422 si no es PDF/PNG/JPEG por contenido; 413 sobre `ADJUNTO_MAX_MB`; 404 titulo ajeno |
| `GET /api/trayectoria/respaldos/:id` | ADMIN, GESTION, PROFESIONAL, PRACTICANTE | el archivo (attachment); ajeno 404; queda en `registro_exportaciones` (recurso `trayectoria_respaldos`) |
| `GET /api/profesionales/:id/trayectoria` | sin cambio de roles | cada titulo trae `respaldos` (metadata, del mas reciente al mas antiguo; nunca el contenido) |
| `POST /api/trayectoria/:id/verificacion` | ADMIN | 422 `trayectoria_verificar_con_respaldo` si no hay respaldo |
| `POST/PUT /api/trayectoria` | PROFESIONAL, PRACTICANTE | ya no aceptan `documentoRespaldoUrl` (400) |

- `EquipoService.subirRespaldo`: tipo por contenido (`tipoPorContenido`),
  id con `randomUUID`, cifra con `LlaveroService.cifrarCampo`, llama a la
  funcion dentro de la transaccion del RlsInterceptor.
- `EquipoModule` registra `MulterModule` con `ADJUNTO_MAX_MB` (como Fichas);
  la foto de perfil mantiene su propio limite.

## 5. Front

- `components/equipo/MiPerfilProfesional.tsx` (`MiTrayectoria`, usada en el
  inspector "Formacion" del editor del perfil y en Mi cuenta):
  - el formulario pide "Respaldo del titulo" (archivo) al agregar;
    "Agregar titulo y respaldo" como en el diseño;
  - al editar, el archivo es opcional ("Nuevo respaldo");
  - si el titulo se guarda pero la subida falla, lo dice y deja subirlo
    desde la lista;
  - cada titulo tiene "Subir respaldo" o "Nueva version".
- `components/equipo/RespaldoTitulo.tsx` (nuevo): muestra el ultimo archivo
  con su descarga y cuantas versiones anteriores hay, o "Falta el respaldo".
  Lo usan la Formacion del profesional y la ficha del integrante.
- `components/equipo/FichaIntegrante.tsx`: el ADMIN descarga el respaldo y
  verifica; "Verificar" queda deshabilitado sin respaldo y el 422 se muestra.
- Seed demo: los titulos verificados suben un PDF minimo de demostracion
  antes de verificarse.

## 6. Pruebas

- `seguridad_bd.sql` caso 159: verificar sin respaldo (23514), ADMIN no
  sube (42501), titulo ajeno (P0002), sin INSERT/UPDATE/DELETE directos
  (42501), tipo invalido (23514), lectura por rol (propio, otro profesional,
  PACIENTE, GESTION), version nueva vuelve a revision, eliminar el titulo se
  lleva sus respaldos. Caso 70 sube un respaldo antes de verificar.
- Integracion `test/sesion-respaldos.e2e-spec.ts` (por rol, descarga,
  cifrado en reposo, registro de descargas, versiones, cascada) y
  `test/02e-equipo.e2e-spec.ts` (422 sin respaldo, 400 con enlace).

## 7. Abierto

- Retencion de la evidencia despues del cierre de cuenta (2.1): decision legal.
- Limite de versiones por titulo: no hay; cada una cuesta hasta
  `ADJUNTO_MAX_MB` en la BD. Si crece, mover archivos a almacenamiento de
  objetos (mismo pendiente que `adjuntos_ficha`, `docs/api/integraciones.md`).
