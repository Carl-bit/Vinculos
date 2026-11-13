-- Punto 23 (correcciones 2026-11-11): el indicador de boxes del dashboard
-- muestra horas libres de hoy (mas util que un porcentaje). Se agrega
-- horas_libres_boxes_hoy (minutos apartados en boxes menos los ocupados, en
-- horas con un decimal); ocupacion_boxes_hoy se mantiene por compatibilidad.
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('reporte_dashboard()'::regprocedure);
  nuevo := replace(def, $q$    'boxes_activos', (SELECT count(*) FROM espacios WHERE activo),$q$,
                        $q$    'horas_libres_boxes_hoy', round(greatest(v_minutos_box - v_minutos_ocupados, 0) / 60.0, 1),
    'boxes_activos', (SELECT count(*) FROM espacios WHERE activo),$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'reporte_dashboard no trae la linea esperada';
  END IF;
  EXECUTE nuevo;
END $$;
