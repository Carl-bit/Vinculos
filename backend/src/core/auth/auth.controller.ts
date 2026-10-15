import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';

import { TAGS } from '../docs/openapi';
import { LoginDto, RefreshDto } from './auth.dto';
import { AuthService, type Tokens } from './auth.service';
import { Publico } from './decoradores';

/** Rate limit por IP: throttler 'login' (LOGIN_LIMITE_POR_MINUTO). */
@ApiTags(TAGS.auth)
@Controller('auth')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ publico: true })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<Tokens> {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<Tokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }
}
