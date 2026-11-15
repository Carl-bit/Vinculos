# Imagenes por digest (R1)

Todos los silos corren las mismas dos imagenes, `vinculos-api` (migrate y
backend) y `vinculos-web` (frontend), fijadas por digest
(`<registro>/vinculos-api@sha256:...`). Lo propio de cada centro entra en
runtime por su `.env` (R9/R11). Un silo real nunca construye: corre lo
publicado, byte a byte.

## Piezas

| Pieza | Donde | Que hace |
|---|---|---|
| `infra/docker-compose.yml` | ERP | El silo, sin `build`: `${REGISTRO}/vinculos-api@${API_DIGEST}` y `${REGISTRO}/vinculos-web@${WEB_DIGEST}`. Con esas variables vacias el `up` falla (referencia invalida): falla cerrado |
| `infra/docker-compose.build.yml` | ERP | Override que construye desde el codigo (`vinculos-api:dev`). Solo desarrollo y silos de prueba (`servidor.sh`, `stress/`) |
| `infra/scripts/imagenes/publicar.sh` | ERP, se corre en el host B | Construye, sube y anota los digests en `infra/imagenes/<version>.env` |
| Registro `registry:2` | Plano de control, `infra/host-b/docker-compose.yml` | Escucha solo en `127.0.0.1:5000` del host B, sin borrado |

## Publicar una version

En el host B, desde la raiz del repo del ERP, con el commit a publicar:

```sh
sh infra/scripts/imagenes/publicar.sh            # version de backend/package.json
sh infra/scripts/imagenes/publicar.sh 0.1.0-rc.1 # misma version con sufijo de prueba
```

El script:

1. Exige que `backend/package.json` y `frontend/package.json` tengan la misma
   version y que la pedida sea esa (o esa con sufijo).
2. Exige el arbol limpio. Con cambios sin commit solo publica una version con
   sufijo y `PERMITIR_SUCIO=1` (pruebas), y anota el commit como `-sucio`.
3. Se niega si el tag ya existe en el registro: **los tags son inmutables**,
   una correccion es una version nueva. Lo revisa antes de construir y otra
   vez justo antes de subir.
4. Construye sin atestaciones (`--provenance=false --sbom=false`: un
   manifiesto por imagen) y con labels OCI de version, commit y fecha.
5. Sube, pide al registro el digest (lo que bajara cada silo) y baja por
   digest para comprobarlo.
6. Escribe `infra/imagenes/<version>.env` (ignorado por git; es estado del
   host B):

   ```
   VINCULOS_VERSION=0.1.0
   REGISTRO=127.0.0.1:5000
   API_DIGEST=sha256:...
   WEB_DIGEST=sha256:...
   VINCULOS_COMMIT=<sha>
   VINCULOS_PUBLICADO=<fecha UTC>
   ```

   Esas lineas van tal cual al `.env` del silo. El job `aprovisionar` y
   `actualizar` del plano de control las toman de ahi (el agente lee la carpeta
   en solo lectura y le informa el release a la consola).

## Desplegar un silo real

```sh
cat infra/imagenes/0.1.0.env >> infra/.env    # o el .env del silo
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
```

Sin `--build` y sin el override: si falta un digest, no levanta.

## Por que el registro va sin TLS ni usuario

Escucha solo en el loopback del host B. Lo usan el daemon de Docker (pull) y
`publicar.sh` (push), los dos en el mismo host y con acceso al socket de
Docker, que ya es acceso total al host. No sale por el tunel ni por Traefik y
ningun contenedor lo alcanza por red. Docker acepta HTTP para `127.0.0.0/8`
sin configurar `insecure-registries`. Si alguna vez se expone fuera del
loopback, necesita TLS y usuario.

El volumen del registro (`registro_datos`) se respalda con el host: las
imagenes no se reconstruyen con el mismo digest.

## En produccion (host B en un VPS, plano de control en otro host)

El flujo no cambia de forma: las imagenes nunca pasan por el plano de control.
La consola solo registra versiones y digests, y el host B sigue sin puertos
abiertos.

1. **Hoy (MVP):** `publicar.sh` corre en el host B desde un checkout del ERP.
2. **Despues, con CI (GitHub Actions):** la CI construye y publica en un
   registro externo privado (GHCR) y anota los digests. En el host B, un
   `importar.sh <version>` copia de GHCR al registro local **por digest**
   (`crane copy` o `skopeo copy`, que conservan el digest) y escribe el mismo
   `infra/imagenes/<version>.env`. Son conexiones salientes del host B,
   igual que el agente: nada entra.
3. En los dos casos el agente informa el release al plano de control por su
   canal de siempre (HTTPS saliente). El plano de control nunca abre
   conexiones hacia el host B.

Al migrar a AWS ECR rigen las mismas reglas: tags inmutables (ECR lo
impone con `imageTagMutability=IMMUTABLE`) y cada silo con tag + digest.
