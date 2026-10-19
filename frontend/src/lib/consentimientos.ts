/**
 * Textos de los consentimientos que responde el paciente (o su adulto
 * responsable): que se acepta y que pasa si se rechaza. El documento legal es
 * una politica versionada en la API (CONSENTIMIENTO_ATENCION y, desde 03b-5,
 * CONSENTIMIENTO_PRACTICANTE): aceptar envia su version vigente y la BD la
 * exige. Aca solo va el resumen que acompaña al documento.
 */

export type TipoConsentimientoEnlace = 'ATENCION' | 'PRACTICANTE' | 'AVISO_SUPERVISOR';

interface Personas {
  practicante?: string | null;
  supervisor?: string | null;
  supervisorAnterior?: string | null;
  menor?: boolean;
}

export interface TextoConsentimiento {
  titulo: string;
  resumen: string;
  acepta: { boton: string; consecuencia: string };
  rechaza: { boton: string; consecuencia: string };
  puntos: string[];
}

export function textoConsentimiento(tipo: TipoConsentimientoEnlace, p: Personas = {}): TextoConsentimiento {
  const atencion = p.menor ? 'la atención del menor a tu cargo' : 'tu atención';
  const practicante = p.practicante ?? 'un practicante del centro';
  const supervisor = p.supervisor ?? 'un profesional del equipo';
  if (tipo === 'PRACTICANTE') {
    return {
      titulo: 'Atención con un practicante supervisado',
      resumen: `Te proponemos que ${atencion} la realice ${practicante}, profesional en formación, con la supervisión de ${supervisor}.`,
      puntos: [
        `${practicante} atiende las sesiones y registra la ficha clínica como cualquier profesional del centro.`,
        `${supervisor} revisa los casos sin ver tu nombre ni tus datos de contacto (supervisión seudonimizada).`,
        'Si cambia quien supervisa, te avisaremos y podrás oponerte.',
        'Puedes retirar este consentimiento cuando quieras desde tu cuenta.',
      ],
      acepta: { boton: 'Acepto la atención supervisada', consecuencia: `${practicante} queda a cargo de la atención y podrá agendar contigo.` },
      rechaza: {
        boton: 'Prefiero no ser atendido por un practicante',
        consecuencia: 'No te atenderá un practicante: el centro buscará otro profesional para continuar la atención.',
      },
    };
  }
  if (tipo === 'AVISO_SUPERVISOR') {
    return {
      titulo: 'Cambio de quien supervisa la atención',
      resumen: `La atención con ${practicante} sigue igual, pero ahora la supervisa ${supervisor}${p.supervisorAnterior ? ` (antes ${p.supervisorAnterior})` : ''}.`,
      puntos: [
        'El practicante, tus horas y tu ficha no cambian.',
        `${supervisor} revisa los casos sin ver tu nombre ni tus datos de contacto.`,
        'Si no respondes antes del plazo, se entiende que estás conforme.',
      ],
      acepta: { boton: 'Estoy conforme', consecuencia: 'La atención continúa con la nueva supervisión.' },
      rechaza: {
        boton: 'Me opongo al cambio',
        consecuencia:
          'Oponerte equivale a retirar el consentimiento: las horas futuras con el practicante quedan por reprogramar y el centro te ofrecerá otro profesional.',
      },
    };
  }
  return {
    titulo: 'Consentimiento informado de atención',
    resumen: `Antes de empezar, el centro necesita tu consentimiento para ${atencion}. Lee el documento completo.`,
    puntos: [],
    acepta: { boton: 'Acepto el consentimiento', consecuencia: 'Queda registrada tu aceptación de esta versión del documento, con la fecha.' },
    rechaza: {
      boton: 'No acepto',
      consecuencia: 'No se registra nada. Sin consentimiento el centro no puede iniciar la atención; puedes conversarlo con tu profesional o en recepción.',
    },
  };
}
