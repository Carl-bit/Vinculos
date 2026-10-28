# Usuarios demo (03b-4.1)

Centro de demostración para pruebas manuales y Playwright. Solo desarrollo:
`npm run seed:demo` (o `npm run demo:reset` para recargar desde cero, desde
`backend/`, en PowerShell). El seed se niega con `NODE_ENV=production`.

- Contraseña de todos: `dev-password` (`SEED_PASSWORD` la cambia).
- Dominio: `@centro-prueba.cl` (por ejemplo `admin@centro-prueba.cl`).
- Se entra con **correo o RUT** (los que tienen RUT registrado).
- **Segundo paso**: todo el equipo recibe un código de 6 dígitos por correo
  en cada ingreso. Los correos llegan a **Mailpit**: http://localhost:8025
  (`npm run dev` en la raíz lo levanta o reutiliza). El primer ingreso de
  cada cuenta del equipo muestra 10 códigos de respaldo (un uso cada uno).
- Pacientes y adultos responsables entran sin segundo paso salvo que lo
  activen en Mi cuenta > Seguridad.
- **Modo demo del login**: con `NEXT_PUBLIC_DEMO=true` en el front (nunca en
  producción; el selector tampoco aparece con `NODE_ENV=production`) la
  pantalla de ingreso muestra "Modo demo: entrar como", que completa correo y
  contraseña de cada usuario. El código igual llega a Mailpit.

  ```powershell
  $env:NEXT_PUBLIC_DEMO = 'true'; npm run dev
  ```

## Equipo

| Usuario | Rol(es) | RUT para ingresar | Para qué |
|---|---|---|---|
| `admin` | ADMIN + PROFESIONAL | — | cuenta madre; selector de rol activo (03b-4.1); perfil profesional sin publicar (Mi perfil muestra su perfil profesional) |
| `directora` | ADMIN + PROFESIONAL | — | cambio de rol activo (prueba de roles) |
| `gestion` | GESTION | — | agenda, cobros, consentimientos, selector de equipo |
| `profesional1` | PROFESIONAL | 12.345.678-5 | tratante de Paciente Prueba y Diego; perfil completo (FONASA, boleta, idiomas, formación verificada, reseña) |
| `profesional2` | PROFESIONAL | — | supervisor del practicante; tratante de Sofía y Tomás |
| `profesional3` | PROFESIONAL | — | candidato de la derivación en curso; tratante de Ignacio; solo presencial lun/mié/vie |
| `profesional4` | PROFESIONAL | — | solo online, $25.000, FONASA, terapia de pareja y familia |
| `profesional5` | PROFESIONAL | — | solo presencial, $55.000, boleta reembolsable, adolescentes y niños (Box 3 lun/mié/vie) |
| `profesional6` | PROFESIONAL | — | mixta, $45.000 (online $42.000), FONASA y boleta; martes y jueves |
| `practicante` | PRACTICANTE | — | tratante de Camila (consentimiento vigente), acceso por 90 días |
| `inactivo` | PROFESIONAL desactivado | — | login rechazado |
| `practicante.expirado` | PRACTICANTE vencido | — | login rechazado |

Seis profesionales con perfil público (`profesional1` a `profesional6`) con
especialidades, tarifas, modalidades, previsión y días distintos: sirven para
los filtros del equipo, el presupuesto por tramos y el match.

## Portal

| Usuario | Rol | RUT | Para qué |
|---|---|---|---|
| `paciente` | PACIENTE adulto | 11.111.111-1 | Paciente Prueba: horas, pagos, documentos, mensajes, reseña |
| `paciente2` | PACIENTE | 22.222.222-2 | Camila, atendida por el practicante |
| `paciente3` | PACIENTE | 33.333.333-3 | Diego, derivación en curso |
| `moroso` | PACIENTE | 21.111.111-9 | Rodrigo, llegó por el centro; moroso (sesión realizada impaga), hora siguiente autorizada por GESTION con motivo |
| `adolescente` | PACIENTE 16 años | 25.555.555-3 | cuenta restringida (horas, recordatorios, mensajes) |
| `madre.demo` | RESPONSABLE | 15.555.555-6 | adulta responsable de Sofía (12 años) |

Pacientes sin cuenta: Sofía (24.444.444-K), Andrés (26.666.666-7, de
Profesional Cuatro), Valentina (15 años, 27.777.777-0, de Profesional Cinco,
con su madre como responsable) y Rocío (28.888.888-4, de Profesional Seis);
cada profesional nuevo tiene dos horas agendadas. Reservas sin cuenta en
cada estado de pago (retenida, pago en el centro, transferencia por validar,
pagada en línea, liberada): ver `guion_manual.md` 0.5.

## Verificación

`docs/pruebas/verificacion_roles.md` (Playwright `e2e/roles.spec.ts`) recorre
los usuarios por rol.

Agenda del seed (03b-4.1): todos los profesionales y el practicante tienen horas hoy y el próximo día hábil, si caen en los días de sus bloques; las de hoy que ya empezaron quedan sin evolución ("fichas por cerrar"). La morosidad cuenta desde la hora del seed y el centro bloquea a morosos, así que las horas de hoy y del próximo día hábil quedan pagadas en el centro (también las que terminan después del seed): solo Rodrigo queda moroso. La siguiente hora impaga del seed es a 2 días hábiles; si pasó ese plazo, `npm run demo:reset` antes de las pruebas que agendan.

Moroso y protocolo (03b-4.2): las sesiones de hoy que ya terminaron al correr el seed quedan pagadas en el centro y `morosidad_desde` se adelanta a justo antes de la sesión impaga de Rodrigo, así que él es el único moroso. Protocolo del centro: profesional1 lo marcó leído (el resto del equipo figura pendiente en Configuración > Políticas) y Paciente Prueba acusó el de pacientes. Comisión: 20 % general y $5.000 por sesión de pacientes que llegaron por el centro (Rodrigo y las reservas pagadas del sitio).
