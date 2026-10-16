import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';

import { TAGS } from '../docs/openapi';
import { CambioRolDto, CorreoDto, DesafioDto, LoginDto, RefreshDto, TokenDto, TokenPasswordDto, TotpDto } from './auth.dto';
import { AuthService, type DesafioTotp, type Tokens } from './auth.service';
import { Publico } from './decoradores';

/**
 * Rate limit por IP: throttler 'login' (LOGIN_LIMITE_POR_MINUTO), tambien
 * para recuperacion, enlace de acceso y activacion (respuestas identicas
 * exista o no la cuenta).
 */
@ApiTags(TAGS.auth)
@Controller('auth')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ publico: true })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Correo (o RUT del paciente) y contraseña. Con TOTP (obligatorio en roles clinicos) responde un desafio. */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<Tokens | DesafioTotp> {
    return this.auth.login({ email: dto.email, rut: dto.rut }, dto.password, dto.rol);
  }

  /** Segundo factor: codigo de la app (activa el TOTP si era el enrolamiento). */
  @Post('totp')
  @HttpCode(200)
  totp(@Body() dto: TotpDto): Promise<Tokens> {
    return this.auth.verificarTotp(dto.desafio, dto.codigo);
  }

  /** Enrolamiento TOTP: secreto y URI otpauth para el codigo QR. */
  @Post('totp/enrolamiento')
  @HttpCode(200)
  enrolar(@Body() dto: DesafioDto) {
    return this.auth.enrolarTotp(dto.desafio);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<Tokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Cambiar el rol de la sesion (cuentas con dos roles): tokens nuevos, la familia anterior queda revocada. */
  @Post('cambio-rol')
  @HttpCode(200)
  cambioRol(@Body() dto: CambioRolDto): Promise<Tokens> {
    return this.auth.cambiarRol(dto.refreshToken, dto.rol);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  /** Siempre 204 (no revela si la cuenta existe). */
  @Post('recuperacion')
  @HttpCode(204)
  recuperacion(@Body() dto: CorreoDto): Promise<void> {
    return this.auth.pedirRecuperacion(dto.email);
  }

  @Post('recuperacion/confirmacion')
  @HttpCode(204)
  confirmarRecuperacion(@Body() dto: TokenPasswordDto): Promise<void> {
    return this.auth.confirmarRecuperacion(dto.token, dto.password);
  }

  /** Pacientes y adultos responsables: enlace de acceso de un solo uso. Siempre 204. */
  @Post('enlace-acceso')
  @HttpCode(204)
  enlaceAcceso(@Body() dto: CorreoDto): Promise<void> {
    return this.auth.pedirEnlaceAcceso(dto.email);
  }

  @Post('enlace-acceso/confirmacion')
  @HttpCode(200)
  usarEnlaceAcceso(@Body() dto: TokenDto): Promise<Tokens | DesafioTotp> {
    return this.auth.usarEnlaceAcceso(dto.token);
  }

  /** Invitacion (equipo, paciente o adulto responsable): fija la contraseña y entra. */
  @Post('activacion')
  @HttpCode(200)
  activar(@Body() dto: TokenPasswordDto): Promise<Tokens | DesafioTotp> {
    return this.auth.activarInvitacion(dto.token, dto.password);
  }

  /** Confirma el correo nuevo de un paciente o adulto responsable (C-9). */
  @Post('correo/verificacion')
  @HttpCode(204)
  verificarCorreo(@Body() dto: TokenDto): Promise<void> {
    return this.auth.confirmarCambioCorreo(dto.token);
  }
}
