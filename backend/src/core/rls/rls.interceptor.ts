import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';

import { ContextoBd, type UsuarioActual } from '../bd/contexto-bd.service';

/**
 * Envuelve cada request autenticada en una transaccion con contexto RLS
 * (ContextoBd.enTransaccion). La respuesta se envia despues del COMMIT: un
 * error al COMMIT (trigger diferido) llega al filtro global como cualquier
 * otro. Rutas @Publico (sin usuario) no abren transaccion: sus servicios usan
 * ContextoBd.sinContexto() de forma explicita.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(private readonly bd: ContextoBd) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const usuario = context.switchToHttp().getRequest<{ user?: UsuarioActual }>().user;
    if (!usuario) {
      return next.handle();
    }
    return from(this.bd.enTransaccion(usuario, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }
}
