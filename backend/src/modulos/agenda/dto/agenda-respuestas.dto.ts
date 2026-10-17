/**
 * Respuestas de los endpoints de agenda nuevos en 03b (bloques de box). En un
 * archivo *.dto.ts para que el plugin de Swagger documente el contrato y el
 * front lo tome del esquema generado.
 */

/** Horas de box apartadas por un profesional (su agenda). */
export class BloqueAtencionVista {
  id!: string;
  profesionalId!: string;
  espacioId!: string;
  inicio!: Date;
  fin!: Date;
  creadoEn!: Date;
}

/** Horas libres de un box para apartar (sin profesionales ni pacientes). */
export class HoraLibreBox {
  espacioId!: string;
  inicio!: Date;
  fin!: Date;
}

export class BloquesLiberados {
  eliminados!: number;
}
