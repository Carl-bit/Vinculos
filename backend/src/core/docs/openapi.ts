/**
 * Documentacion OpenAPI (02j). /docs (Swagger UI) y /docs-json solo fuera de
 * produccion, salvo que DOCS_API lo fuerce (true/false). Los DTOs se
 * documentan solos con el plugin de @nestjs/swagger (nest-cli.json:
 * class-validator + comentarios JSDoc); roles y errores comunes los agregan
 * @Roles y @Publico (core/auth/decoradores.ts).
 */
import { applyDecorators, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProperty, ApiPropertyOptional, ApiResponse, DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/** Cuerpo de error del filtro global (core/errores/filtro-errores.ts). */
export class ErrorRespuesta {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ example: 'CONFLICT' })
  error!: string;

  @ApiProperty({ example: 'El box ya esta ocupado en ese horario', description: 'Mensaje propio (nunca el de Postgres); lista en errores de validacion (400)' })
  mensaje!: string;

  @ApiPropertyOptional({ example: '23P01' })
  sqlstate?: string;

  @ApiPropertyOptional({ example: 'citas_no_solapamiento_espacio', description: 'Regla de la BD que fallo, para que la UI distinga casos' })
  restriccion?: string;

  @ApiPropertyOptional()
  requestId?: string;
}

const error = (status: number, description: string) => ApiResponse({ status, description, type: ErrorRespuesta });

/** Errores que puede devolver cualquier ruta autenticada (guard + transaccion RLS + filtro global). */
export const ErroresAutenticados = () =>
  applyDecorators(
    error(400, 'DTO invalido (class-validator) o campo no declarado'),
    error(401, 'Sin token, token vencido o cuenta inactiva/expirada'),
    error(403, 'Rol no permitido (matriz_permisos.md) o RLS (42501)'),
    error(404, 'No existe o no es visible para el usuario (RLS)'),
    error(409, 'Choque de horario (23P01), duplicado (23505) o estado que no permite la accion (55000)'),
    error(422, 'Regla de negocio de la BD (23514, 23503)'),
  );

export const ErroresPublicos = () => applyDecorators(error(400, 'Parametros invalidos'), error(429, 'Limite de consultas por minuto e IP'));

export const ErrorCuerpoGrande = () => error(413, 'Cuerpo mayor al limite (JSON 1 MB; adjuntos ADJUNTO_MAX_MB)');

export const TAGS = {
  auth: 'Autenticacion',
  salud: 'Salud',
  mensajeria: 'Mensajeria',
  nucleo: 'Nucleo',
  fichas: 'Fichas y pacientes',
  agenda: 'Agenda y espacios',
  equipo: 'Equipo',
  derivaciones: 'Derivaciones y consentimientos',
  publico: 'Match publico',
  portal: 'Portal del paciente',
  cobros: 'Cobros',
} as const;

export function documentoOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Vinculos API')
    .setDescription(
      'ERP modular para centros clinicos (silo de un centro). Login en POST /api/auth/login y usar el accessToken en "Authorize". ' +
        'Roles por ruta segun docs/seguridad/matriz_permisos.md; la BD aplica igual su RLS.',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build();
  const documento = SwaggerModule.createDocument(app, config);
  documento.tags = Object.values(TAGS).map((name) => ({ name }));
  return documento;
}

/** Monta /docs si corresponde. Devuelve si quedo montada. */
export function configurarOpenApi(app: INestApplication): boolean {
  if (!docsHabilitada(app.get(ConfigService).get<boolean>('DOCS_API'), process.env.NODE_ENV)) {
    return false;
  }
  SwaggerModule.setup('docs', app, () => documentoOpenApi(app), { swaggerOptions: { persistAuthorization: true } });
  return true;
}

export const docsHabilitada = (docsApi: boolean | undefined, nodeEnv: string | undefined) => docsApi ?? nodeEnv !== 'production';
