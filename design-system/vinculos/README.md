# design-system/vinculos

`MASTER.md` lo genera `ui-ux-pro-max` y es la referencia para las vistas que
**no** existen todavia en el handoff de Claude Design. Los overrides por pagina
van junto a el, no dentro del codigo de la vista.

Orden de precedencia cuando hay conflicto:

1. Handoff de Claude Design ("Vinculos Landing Page Design", tenant Centro
   Ejemplo) — o su export HTML en `design-reference/`.
2. `MASTER.md` de esta carpeta.
3. Nada mas. Si una vista no esta en ninguno de los dos, se agrega primero a
   `MASTER.md` y despues se implementa.

Los tokens concretos se cargan en `frontend/src/app/globals.css` (`@theme`).
Despues de generar cada vista nueva: `npx impeccable detect` sobre los archivos
tocados, y corregir antes de seguir.
