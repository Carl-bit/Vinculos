# Coleccion Bruno (pruebas manuales)

Abrir esta carpeta en Bruno y elegir el entorno `local`. Correr primero
`01 Autenticacion` (guarda un token por rol y los ids). Preparacion, usuarios
demo y resultado esperado de cada request: `docs/pruebas/guion_manual.md`.

```sh
bru run --env local -r     # corrida completa: antes, npm run demo:reset
```

Los pasos del recordatorio (07/09-11) usan la variable de entorno
`tokenRecordatorio`: pegar el token del correo de Mailpit; vacia, esos tests
se saltan.
