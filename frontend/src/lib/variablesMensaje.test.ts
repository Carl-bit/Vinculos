import { describe, expect, it } from 'vitest';

import { aDatosSimples, aVariables, datoInvalido, DATOS_DOCUMENTO, DATOS_MENSAJE } from './variablesMensaje';

describe('datos de los mensajes', () => {
  it('muestra y guarda el mismo texto (ida y vuelta)', () => {
    const guardado = 'Hola {{nombre_paciente}}: cita con {{nombre_profesional}} en {{nombre_centro}}, {{fecha}} {{hora}} ({{modalidad}}). {{enlace}}';
    const simple = aDatosSimples(guardado);
    expect(simple).toBe('Hola {paciente}: cita con {profesional} en {centro}, {fecha} {hora} ({modalidad}). {enlace}');
    expect(aVariables(simple, DATOS_MENSAJE)).toBe(guardado);
  });

  it('tolera mayusculas, espacios y llaves dobles', () => {
    expect(aVariables('{Paciente} { hora } {{centro}}', DATOS_MENSAJE)).toBe('{{nombre_paciente}} {{hora}} {{nombre_centro}}');
  });

  it('avisa si el dato no existe o una llave queda sin cerrar', () => {
    expect(datoInvalido('Hola {paciente}', DATOS_MENSAJE)).toBeNull();
    expect(datoInvalido('Hola {mascota}', DATOS_MENSAJE)).toContain('«{mascota}»');
    expect(datoInvalido('Hola {paciente', DATOS_MENSAJE)).toContain('«{paciente»');
    expect(datoInvalido('Hola paciente}', DATOS_MENSAJE)).toContain('«}»');
  });

  it('cada lista solo admite sus datos', () => {
    expect(datoInvalido('{contenido}', DATOS_MENSAJE)).not.toBeNull();
    expect(datoInvalido('{hora}', DATOS_DOCUMENTO)).not.toBeNull();
  });
});
