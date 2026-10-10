#!/bin/sh
# Detiene y borra la BD efimera y las llaves de prueba que creo levantar.sh.
# Uso: sh test/bd/bajar.sh <dir-del-cluster> <dir-de-secretos>
pg_ctl -D "$1/data" -m fast -w stop >/dev/null 2>&1
rm -rf "$1" "$2"
