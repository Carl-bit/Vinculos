# Servidor de pruebas (Ubuntu + Cloudflare Tunnel)

Uso: demostracion, compartir el sistema y pruebas de estres. **Solo datos
ficticios** hasta nuevo aviso. Dos silos:

| Silo | Para que | Datos |
|---|---|---|
| `estres` | Centro "en funcionamiento"; k6 corre contra el | Se conservan (no se reinicia) |
| `demo` | Que otras personas prueben las interacciones | Se reinicia (a mano o por cron) |

Piezas: `docker-compose.yml` de la raiz (Traefik + Mailpit, uno por host),
`infra/servidor/servidor.sh` (cada silo, stack `erp-<slug>`, con el compose
real `infra/docker-compose.yml` + `infra/servidor/docker-compose.servidor.yml`).
No hay Dockerfile en la raiz: cada imagen sale de `backend/Dockerfile` y
`frontend/Dockerfile`.

## 1. Requisitos del host

```sh
sudo apt install -y git openssl          # Docker Engine 29 + plugin compose (docs.docker.com/engine/install/ubuntu)
sudo timedatectl set-timezone America/Santiago   # cron de respaldos
git clone <repo> vinculos && cd vinculos
```

Internet: para `git clone`, bajar imagenes y construir (npm y la fuente
Figtree de Google en el build del front). Despues, el sistema corre sin
descargar nada; solo necesita la salida del tunel. Si el build del front falla
en "Failed to fetch font", reintentar: es la descarga.

## 2. Cloudflare

### 2.1 Token para el certificado

Cloudflare Tunnel no abre puertos, por eso Let's Encrypt no puede validar por
HTTP: Traefik valida por DNS (crea un registro TXT temporal en la zona).

1. dash.cloudflare.com, My Profile, API Tokens, Create Token, plantilla
   **Edit zone DNS**.
2. Zone Resources: Include, Specific zone, tu dominio. Crear y copiar.
3. `cp .env.example .env` y completar `ACME_EMAIL`, `CF_DNS_API_TOKEN`,
   `DOMINIO_CORREO` (por ejemplo `correo.midominio.cl`) y `MAILPIT_UI_AUTH`
   (`usuario:clave` larga: quien la tenga lee los codigos de ingreso).

### 2.2 Tunel hacia Traefik

Traefik no publica puertos: cloudflared lo alcanza por la red Docker `proxy`.

1. Unir tu contenedor de cloudflared a la red (despues de que exista, paso 3):
   `docker network connect proxy <contenedor-cloudflared>`. Para que no se
   pierda al recrearlo, agregar en su compose `networks: [proxy]` con
   `proxy: external: true`.
2. Zero Trust, Networks, Tunnels, tu tunel, Public Hostname, Add, una vez por
   dominio (`estres`, `demo`, `correo`):
   - Subdomain `estres`, Domain `midominio.cl`.
   - Service: **HTTPS**, URL `traefik:443`.
   - Additional application settings, TLS: **Origin Server Name** =
     `estres.midominio.cl` (Traefik rechaza la conexion si el nombre no
     coincide: `sniStrict`). Alternativa: activar *Match SNI to Host*.
   - Cloudflare crea el CNAME del subdominio solo.
3. Si el tunel se maneja con `config.yml` en vez del panel:

   ```yaml
   ingress:
     - hostname: "*.midominio.cl"
       service: https://traefik:443
       originRequest:
         matchSNItoHost: true
     - service: http_status:404
   ```

Usar un solo nivel (`estres.midominio.cl`): el certificado gratis del borde
de Cloudflare no cubre `a.b.midominio.cl`.

## 3. Levantar

```sh
PERFIL=estres sh infra/servidor/servidor.sh levantar estres estres.midominio.cl "Centro Estres"
sh infra/servidor/servidor.sh levantar demo demo.midominio.cl "Centro Demo"
sh infra/servidor/servidor.sh estado
```

La primera vez, por silo (5 a 10 minutos, construye las imagenes):

1. Levanta Traefik y Mailpit (si no estaban).
2. Genera `infra/servidor/silos/<slug>.env` con contraseñas al azar (fuera de git).
3. BD y migraciones.
4. Llaves por el runbook (seccion 4).
5. Datos demo (`seed.ts` y `seed-demo.ts` dentro de la red del silo).
6. API y front, y espera `/api/salud`.

Volver a correr `levantar` no repite llaves ni datos: actualiza las imagenes
(despues de un `git pull`) y vuelve a migrar.

Tema visual: `TEMA=moderno` en el `.env` del silo (`<html data-tema>`). Para
cambiarlo, editar esa linea y volver a correr `levantar <slug>`. Solo se
reconstruye el front; datos y llaves quedan igual.

Certificado: el primero tarda unos minutos.
`docker logs vinculos-servidor-traefik-1 2>&1 | grep -i acme` no debe mostrar
errores. Mientras no exista, el navegador ve un error de TLS.

Entrar: `https://demo.midominio.cl/ingreso`, cuentas de
`docs/pruebas/usuarios_demo.md`. La contraseña es `SEED_PASSWORD` del `.env`
del silo. El codigo del segundo paso llega a `https://correo.midominio.cl`.

## 4. Llaves

| Archivo | Que es | Donde |
|---|---|---|
| KEK (`infra/secrets/<slug>/kek`) | Llave maestra: cifra las DEKs | Solo el contenedor `backend` (Docker secret) |
| DEKs | Cifran las columnas con RUT, contacto y texto clinico | Tabla `llaves_datos`, cifradas con la KEK |
| `recuperacion.pub` | Publica del par de recuperacion | Silo |
| `parte_1..3.shamir` | Privada de recuperacion en 3 partes (2 de 3 la rehacen) | Custodios; nunca en el host |
| `respaldo.key` | Cifra los respaldos (openssl) | Host; lo crea `instalar.sh` |

`servidor.sh` corre `aprovisionar.sh` solo la primera vez y **borra las 3
partes**, porque los datos son ficticios. Sin partes, si se pierde la KEK no
se recuperan los datos cifrados de ese silo: hay que reiniciarlo. En un silo
real, las partes se entregan a sus custodios y se corre
`verificar_respaldo.sh` (`docs/seguridad/runbooks_llaves.md`).

## 5. Reiniciar el demo

```sh
sh infra/servidor/servidor.sh reiniciar demo   # borra BD y llaves, vuelve a cargar
```

Por cron (todos los dias a las 04:00):

```
0 4 * * * cd /ruta/vinculos && sh infra/servidor/servidor.sh reiniciar demo >> /var/log/vinculos-demo.log 2>&1
```

Nunca `reiniciar estres` si se quiere conservar lo acumulado.

## 6. Estres contra `estres`

`PERFIL=estres` sube el rate limit por IP: k6 sale de una sola IP. El silo
queda igual publicado; las cuentas tienen una contraseña al azar.

```sh
P=$(sed -n 's/^SEED_PASSWORD=//p' infra/servidor/silos/estres.env)
docker run --rm --network proxy -v "$PWD/backend/pruebas:/scripts:ro" \
  -e API_URL=http://erp-estres-backend-1:3001/api \
  -e MAILPIT_URL=http://<usuario>:<clave>@mailpit:8025 \
  -e PASSWORD="$P" grafana/k6:0.54.0 run /scripts/stress-agenda.js
CLIENTE_SLUG=estres sh infra/stress/verificar.sh   # solapes 0 y sin reinicios
```

Con `MAILPIT_URL`, usar el `usuario:clave` de `MAILPIT_UI_AUTH`. La prueba se
puede repetir: cada corrida reserva horas nuevas.

## 7. Respaldos y monitor

```sh
CLIENTE_SLUG=estres ENV_SILO=infra/servidor/silos/estres.env DOMINIO=estres.midominio.cl \
  MAILTO=operador@midominio.cl sh infra/scripts/continuidad/instalar.sh
```

Sin `DESTINO_RESPALDO`, los respaldos quedan solo en
`infra/respaldos/<slug>/` (7 dias). El monitor `salud.sh` revisa
`https://<dominio>/api/salud` cada 5 minutos. `ALERTA_URL` es opcional.

## Lo que no hay todavia

- La invitacion del primer ADMIN la hara Vinculos Control. Hoy las cuentas
  salen del seed.
- Los silos de prueba comparten Mailpit, como compartiran el SMTP real. Un
  silo de un cliente real nunca usa este Mailpit.
- El silo efimero `infra/stress/` tambien levanta un Mailpit llamado `mailpit`
  en la red `proxy`. No correrlo en este servidor junto al de la raiz: el
  nombre choca.
