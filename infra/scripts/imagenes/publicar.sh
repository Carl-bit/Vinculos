#!/bin/sh
# R1: construye y publica las imagenes comunes (vinculos-api, vinculos-web) en
# el registro privado del host B y anota sus digests. Un silo real corre solo
# lo publicado aqui, por digest (infra/docker-compose.yml, sin `build`).
#
#   sh infra/scripts/imagenes/publicar.sh [<version>]
#
# Desde la raiz del repo, en el host B (el registro escucha solo en su
# 127.0.0.1). Paso a paso y razones: docs/operacion/imagenes.md.
#
# <version>: por defecto la de backend/package.json (debe ser igual a la de
# frontend/package.json). Se acepta esa version o la misma con sufijo de
# prueba (0.1.0-rc.1, 0.1.0-prueba.3), nunca otra.
#
# Reglas (CLAUDE.md del plano de control):
#   - Tags inmutables: si el tag ya existe en el registro, no se publica. Una
#     correccion es una version nueva.
#   - Arbol limpio: se publica un commit, no lo que haya en disco. Con cambios
#     sin commit solo se acepta una version con sufijo y PERMITIR_SUCIO=1.
#   - Salida: infra/imagenes/<version>.env con REGISTRO, API_DIGEST y
#     WEB_DIGEST (se copian tal cual al .env del silo) y el commit. El agente
#     del plano de control lo lee para informar el release a la consola.
#
# Variables: REGISTRO (127.0.0.1:5000), PERMITIR_SUCIO (0).
set -eu

RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
REGISTRO=${REGISTRO:-127.0.0.1:5000}
falla() { echo "publicar: $*" >&2; exit 1; }

version_de() { sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$1" | head -n 1; }
BASE=$(version_de "$RAIZ/backend/package.json")
WEB_BASE=$(version_de "$RAIZ/frontend/package.json")
[ -n "$BASE" ] || falla "sin version en backend/package.json"
[ "$BASE" = "$WEB_BASE" ] || falla "backend ($BASE) y frontend ($WEB_BASE) tienen versiones distintas"
VERSION=${1:-$BASE}

# Version semver X.Y.Z o X.Y.Z-sufijo, y de este codigo.
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$' \
  || falla "version invalida: $VERSION (X.Y.Z o X.Y.Z-sufijo)"
case "$VERSION" in
  "$BASE" | "$BASE"-*) ;;
  *) falla "la version $VERSION no corresponde al codigo ($BASE)" ;;
esac
case "$VERSION" in *-*) PRUEBA=1 ;; *) PRUEBA=0 ;; esac

cd "$RAIZ"
COMMIT=$(git rev-parse HEAD)
if [ -n "$(git status --porcelain)" ]; then
  [ "$PRUEBA" = 1 ] && [ "${PERMITIR_SUCIO:-0}" = 1 ] \
    || falla "hay cambios sin commit. Una version estable sale de un commit; para probar: version con sufijo y PERMITIR_SUCIO=1"
  COMMIT="$COMMIT-sucio"
fi

URL="http://$REGISTRO/v2"
curl -fsS -o /dev/null "$URL/" || falla "no responde el registro en $REGISTRO (docker compose de infra/host-b del plano de control)"

# Lo que resuelve un `pull <imagen>@<digest>`: indice o manifiesto, OCI o Docker.
ACEPTA='application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json'
estado_tag() { # <repo> <tag> -> codigo HTTP
  curl -s -o /dev/null -w '%{http_code}' -I -H "Accept: $ACEPTA" "$URL/$1/manifests/$2"
}
digest_tag() { # <repo> <tag> -> sha256:...
  curl -fsS -I -H "Accept: $ACEPTA" "$URL/$1/manifests/$2" \
    | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: *\(sha256:[0-9a-f]\{64\}\)$/\1/p'
}

for repo in vinculos-api vinculos-web; do
  codigo=$(estado_tag "$repo" "$VERSION")
  case "$codigo" in
    404) ;;
    200) falla "$repo:$VERSION ya existe en el registro. Los tags son inmutables: publicar una version nueva" ;;
    *) falla "el registro respondio $codigo al revisar $repo:$VERSION" ;;
  esac
done

FECHA=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Una imagen por plataforma, sin atestaciones: un solo manifiesto por digest.
construir() { # <repo> <contexto> [args...]
  repo=$1 contexto=$2
  shift 2
  echo "== $repo:$VERSION ($contexto)"
  docker build --pull --provenance=false --sbom=false \
    --label "org.opencontainers.image.title=$repo" \
    --label "org.opencontainers.image.version=$VERSION" \
    --label "org.opencontainers.image.revision=$COMMIT" \
    --label "org.opencontainers.image.created=$FECHA" \
    "$@" -t "$REGISTRO/$repo:$VERSION" "$RAIZ/$contexto"
}
construir vinculos-api backend
# Igual en todos los silos: el alias api-silo existe en cada red `silo` (R11).
construir vinculos-web frontend --build-arg API_URL=http://api-silo:3001

# Se revisa de nuevo justo antes de subir (otra publicacion pudo ganar mientras se construia).
for repo in vinculos-api vinculos-web; do
  [ "$(estado_tag "$repo" "$VERSION")" = 404 ] || falla "$repo:$VERSION aparecio en el registro durante la construccion; no se sube"
done
docker push "$REGISTRO/vinculos-api:$VERSION"
docker push "$REGISTRO/vinculos-web:$VERSION"

# El digest es el que entrega el registro: es lo que bajara cada silo.
API_DIGEST=$(digest_tag vinculos-api "$VERSION")
WEB_DIGEST=$(digest_tag vinculos-web "$VERSION")
[ -n "$API_DIGEST" ] && [ -n "$WEB_DIGEST" ] || falla "el registro no entrego los digests"

# Comprobacion: se baja por digest, igual que un silo.
docker pull -q "$REGISTRO/vinculos-api@$API_DIGEST" >/dev/null
docker pull -q "$REGISTRO/vinculos-web@$WEB_DIGEST" >/dev/null

mkdir -p "$RAIZ/infra/imagenes"
SALIDA="$RAIZ/infra/imagenes/$VERSION.env"
cat > "$SALIDA" <<FIN
# Publicado por infra/scripts/imagenes/publicar.sh. No editar: es el registro
# de lo que se subio. Copiar estas lineas al .env del silo (R1).
VINCULOS_VERSION=$VERSION
REGISTRO=$REGISTRO
API_DIGEST=$API_DIGEST
WEB_DIGEST=$WEB_DIGEST
VINCULOS_COMMIT=$COMMIT
VINCULOS_PUBLICADO=$FECHA
FIN
chmod 644 "$SALIDA"

echo
echo "Publicado $VERSION (commit $COMMIT)"
echo "  $REGISTRO/vinculos-api@$API_DIGEST"
echo "  $REGISTRO/vinculos-web@$WEB_DIGEST"
echo "Digests en $SALIDA"
