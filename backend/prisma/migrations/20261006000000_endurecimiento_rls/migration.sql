-- =============================================================================
-- Endurecimiento de seguridad en BD (prompt 01b). Objetivo: la base falla
-- cerrado aunque la API se equivoque.
--
-- Problema que cierra: la API se conectaba como POSTGRES_USER (superusuario y
-- dueño de las tablas); Postgres no aplica RLS a superusuarios ni al dueño, asi
-- que las politicas de 20261005000100_reglas_dominio no protegian nada si la
-- API olvidaba el SET LOCAL ROLE.
--
-- Corre como dueño de la BD: vinculos_owner (no superusuario, con CREATEROLE
-- y BYPASSRLS; lo crea infra/postgres/init/10-rol-owner.sh). BYPASSRLS le hace
-- falta para crear `app_reportes` con BYPASSRLS y para que los helpers
-- SECURITY DEFINER (dueño = vinculos_owner) lean tablas con FORCE RLS.
-- Ajustada en 01c antes de aplicarse en cualquier entorno: ya no exige
-- superusuario (ALTER ROLE solo LOGIN + asercion; cambio de dueño de la
-- funcion de reporte con GRANT/REVOKE temporales).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Rol de conexion de la API = app_user (opcion a: LOGIN directo).
--
-- Por que no un `app_api` LOGIN miembro de app_user: con un solo proceso de API
-- por silo, un segundo rol solo agrega una indireccion (herencia de membresia)
-- sin separar nada. Las politicas ya apuntan a app_user; conectarse como
-- app_user hace que apliquen sin `SET LOCAL ROLE`, y si la API olvida setear
-- las variables, la RLS sigue activa y devuelve 0 filas.
--
-- La contraseña NO va aqui: la pone backend/prisma/scripts/rol_api.js desde
-- APP_DB_PASSWORD (servicio migrate, en cada despliegue). Sin ese script el rol
-- queda LOGIN sin contraseña, que con autenticacion scram no puede entrar
-- (falla cerrado).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END;
$$;

ALTER ROLE app_user WITH LOGIN;

-- Un dueño no superusuario no puede tocar SUPERUSER/REPLICATION, asi que en vez
-- de reafirmar atributos se verifican: si alguien le dio atajos al rol de la
-- API, la migracion falla.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user'
             AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'app_user tiene atributos privilegiados: revisar antes de migrar';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. Helpers de contexto y acceso vigente.
--
-- acceso_vigente(): el usuario de la transaccion existe, esta activo, su rol en
-- BD coincide con app.current_rol y, si es PRACTICANTE, su
-- fecha_expiracion_acceso no paso. Sin variables -> false (fallo cerrado).
-- Que el rol deba coincidir con la BD evita que un bug de la API (o un JWT
-- viejo tras un cambio de rol) suba privilegios seteando app.current_rol=ADMIN.
--
-- SECURITY DEFINER + search_path fijo: lee `usuarios` como dueño, asi sigue
-- funcionando si `usuarios` recibe RLS mas adelante.
-- -----------------------------------------------------------------------------

CREATE FUNCTION acceso_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = app_usuario_id()
      AND u.activo
      AND u.rol::text = app_rol()
      AND (u.rol <> 'PRACTICANTE' OR u.fecha_expiracion_acceso > now())
  )
$$;


-- -----------------------------------------------------------------------------
-- 3. Politicas reescritas.
--
-- Cambios respecto de reglas_dominio (misma semantica de acceso):
--   - (SELECT app_usuario_id()) / (SELECT app_rol()): Postgres las evalua
--     una vez por consulta (InitPlan), no una vez por fila.
--   - app_usuario_id() ya hace nullif(current_setting(..., true), '')::uuid
--     y app_rol() devuelve text: variable ausente o vacia -> NULL, y NULL nunca
--     calza (NULL = x es NULL, la politica descarta la fila).
-- Las funciones es_profesional_de_* / tiene_derivacion_* reciben la columna de
-- la fila, asi que siguen siendo por fila; sus lookups usan PK o indices
-- existentes (pacientes_profesional_id_idx, fichas_clinicas_paciente_id_key,
-- derivaciones_ficha_clinica_id_idx, evoluciones_ficha_clinica_id_created_at_idx).
-- -----------------------------------------------------------------------------

DROP POLICY pacientes_select ON pacientes;
DROP POLICY pacientes_insert ON pacientes;
DROP POLICY pacientes_update ON pacientes;
DROP POLICY fichas_clinicas_select ON fichas_clinicas;
DROP POLICY fichas_clinicas_insert ON fichas_clinicas;
DROP POLICY fichas_clinicas_update ON fichas_clinicas;
DROP POLICY evoluciones_select ON evoluciones;
DROP POLICY evoluciones_insert ON evoluciones;

-- pacientes
CREATE POLICY pacientes_select ON pacientes FOR SELECT TO app_user
  USING (profesional_id = (SELECT app_usuario_id())
         OR (SELECT app_rol()) = 'ADMIN'
         OR tiene_derivacion_activa_paciente(id));
CREATE POLICY pacientes_insert ON pacientes FOR INSERT TO app_user
  WITH CHECK (profesional_id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN');
CREATE POLICY pacientes_update ON pacientes FOR UPDATE TO app_user
  USING (profesional_id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN')
  WITH CHECK (profesional_id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN');

-- fichas_clinicas (solo metadata; contenido en evoluciones)
CREATE POLICY fichas_clinicas_select ON fichas_clinicas FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id)
         OR (SELECT app_rol()) = 'ADMIN'
         OR tiene_derivacion_activa_ficha(id));
CREATE POLICY fichas_clinicas_insert ON fichas_clinicas FOR INSERT TO app_user
  WITH CHECK (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN');
CREATE POLICY fichas_clinicas_update ON fichas_clinicas FOR UPDATE TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN')
  WITH CHECK (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN');

-- evoluciones: SIN excepcion para ADMIN.
CREATE POLICY evoluciones_select ON evoluciones FOR SELECT TO app_user
  USING (es_profesional_de_ficha(ficha_clinica_id)
         OR tiene_derivacion_activa_ficha(ficha_clinica_id));
CREATE POLICY evoluciones_insert ON evoluciones FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND es_profesional_de_ficha(ficha_clinica_id));


-- -----------------------------------------------------------------------------
-- 4. Auditoria de accesos clinicos (append-only, mismo blindaje que evoluciones).
-- DDL identico al que genera Prisma para el modelo AccesoFicha.
-- -----------------------------------------------------------------------------

CREATE TABLE "accesos_ficha" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "rol" "rol" NOT NULL,
    "paciente_id" UUID NOT NULL,
    "ficha_id" UUID,
    "recurso" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accesos_ficha_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accesos_ficha_paciente_id_ocurrido_en_idx" ON "accesos_ficha"("paciente_id", "ocurrido_en");
CREATE INDEX "accesos_ficha_usuario_id_ocurrido_en_idx" ON "accesos_ficha"("usuario_id", "ocurrido_en");

ALTER TABLE "accesos_ficha" ADD CONSTRAINT "accesos_ficha_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accesos_ficha" ADD CONSTRAINT "accesos_ficha_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accesos_ficha" ADD CONSTRAINT "accesos_ficha_ficha_id_fkey" FOREIGN KEY ("ficha_id") REFERENCES "fichas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El trigger corre incluso para superusuario.
CREATE FUNCTION bloquear_modificacion_auditoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% prohibido en %: auditoria append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER accesos_ficha_append_only BEFORE UPDATE OR DELETE ON accesos_ficha
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();

-- Sin UPDATE ni DELETE.
GRANT SELECT, INSERT ON accesos_ficha TO app_user;

ALTER TABLE accesos_ficha ENABLE ROW LEVEL SECURITY;

-- Solo se registra a si mismo: usuario y rol deben ser los del contexto.
CREATE POLICY accesos_ficha_insert ON accesos_ficha FOR INSERT TO app_user
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND rol::text = (SELECT app_rol()));
CREATE POLICY accesos_ficha_select ON accesos_ficha FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');


-- -----------------------------------------------------------------------------
-- 4b. RLS en derivaciones.
-- Sin esto, app_user tenia INSERT libre: cualquier profesional podia crear una
-- derivacion hacia si mismo y leer evoluciones ajenas, saltandose el protocolo
-- formal. Ahora solo el profesional dueño de la ficha deriva (origen = el
-- mismo) y solo origen o ADMIN la cierran. Los helpers tiene_derivacion_* son
-- SECURITY DEFINER y no se ven afectados.
-- -----------------------------------------------------------------------------

ALTER TABLE derivaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY derivaciones_select ON derivaciones FOR SELECT TO app_user
  USING (profesional_origen_id = (SELECT app_usuario_id())
         OR profesional_destino_id = (SELECT app_usuario_id())
         OR (SELECT app_rol()) = 'ADMIN');
CREATE POLICY derivaciones_insert ON derivaciones FOR INSERT TO app_user
  WITH CHECK (profesional_origen_id = (SELECT app_usuario_id())
              AND es_profesional_de_ficha(ficha_clinica_id));
CREATE POLICY derivaciones_update ON derivaciones FOR UPDATE TO app_user
  USING (profesional_origen_id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN')
  WITH CHECK (profesional_origen_id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN');


-- -----------------------------------------------------------------------------
-- 5. Expiracion de practicantes / usuario desactivado: politica RESTRICTIVE.
-- Se combina con AND sobre las permisivas: aunque una permisiva deje pasar la
-- fila, sin acceso vigente no hay filas ni escritura.
-- -----------------------------------------------------------------------------

CREATE POLICY pacientes_acceso_vigente ON pacientes AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY fichas_clinicas_acceso_vigente ON fichas_clinicas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY evoluciones_acceso_vigente ON evoluciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY accesos_ficha_acceso_vigente ON accesos_ficha AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY derivaciones_acceso_vigente ON derivaciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));


-- -----------------------------------------------------------------------------
-- 6. FORCE RLS en todas las tablas con RLS.
-- Hace que la RLS aplique tambien al dueño de la tabla. Ojo: un superusuario
-- (o un rol con BYPASSRLS) igual se la salta; por eso la defensa real es que
-- la API ya no se conecta como dueño (seccion 1). FORCE cubre el caso de un
-- dueño no superusuario a futuro. Si eso pasa, los helpers SECURITY DEFINER
-- (dueño = migrador) necesitarian que el migrador tenga BYPASSRLS.
-- -----------------------------------------------------------------------------

ALTER TABLE pacientes FORCE ROW LEVEL SECURITY;
ALTER TABLE fichas_clinicas FORCE ROW LEVEL SECURITY;
ALTER TABLE evoluciones FORCE ROW LEVEL SECURITY;
ALTER TABLE accesos_ficha FORCE ROW LEVEL SECURITY;
ALTER TABLE derivaciones FORCE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 7. Reportes agregados sin abrir la RLS al rol de la API.
--
-- app_reportes: NOLOGIN + BYPASSRLS. Nadie se conecta como el ni es miembro;
-- solo es dueño de funciones SECURITY DEFINER que devuelven agregados (nunca
-- filas clinicas). app_user puede ejecutarlas, no puede hacer SET ROLE a el.
-- Toda funcion de reporte valida dentro ADMIN + acceso vigente.
--
-- Vistas de comodidad (si se agregan): siempre WITH (security_invoker = true),
-- si no corren con los permisos del dueño de la vista y se saltan la RLS.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reportes') THEN
    CREATE ROLE app_reportes NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO app_reportes;
GRANT SELECT ON citas, usuarios TO app_reportes;

-- Rango de fechas en hora de Chile, igual que el trigger de menor de edad:
-- [desde 00:00, hasta + 1 dia 00:00).
CREATE FUNCTION reporte_citas_por_profesional(desde date, hasta date)
RETURNS TABLE (
  profesional_id uuid,
  profesional_nombre text,
  citas_confirmadas bigint,
  citas_canceladas bigint,
  minutos_confirmados bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'reporte_citas_por_profesional: solo ADMIN con acceso vigente'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id,
         u.nombre,
         count(*) FILTER (WHERE c.estado = 'CONFIRMADA'),
         count(*) FILTER (WHERE c.estado = 'CANCELADA'),
         coalesce(sum(extract(epoch FROM c.fin - c.inicio) / 60)
                  FILTER (WHERE c.estado = 'CONFIRMADA'), 0)::bigint
  FROM citas c
  JOIN usuarios u ON u.id = c.profesional_id
  WHERE c.inicio >= (desde::timestamp AT TIME ZONE 'America/Santiago')
    AND c.inicio < ((hasta + 1)::timestamp AT TIME ZONE 'America/Santiago')
  GROUP BY u.id, u.nombre
  ORDER BY u.nombre;
END;
$$;

-- Cambiar el dueño exige poder hacer SET ROLE app_reportes y que este tenga
-- CREATE en el schema. CREATE se revoca apenas termina el cambio.
GRANT app_reportes TO current_user;
GRANT CREATE ON SCHEMA public TO app_reportes;
ALTER FUNCTION reporte_citas_por_profesional(date, date) OWNER TO app_reportes;
REVOKE CREATE ON SCHEMA public FROM app_reportes;
REVOKE EXECUTE ON FUNCTION reporte_citas_por_profesional(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reporte_citas_por_profesional(date, date) TO app_user;
