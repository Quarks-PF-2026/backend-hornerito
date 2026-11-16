import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Para rutas públicas que se enriquecen con la sesión si la hay: declarar una
 * donación económica la asocia a la cuenta (QK-113), y la reusará la ficha
 * pública para personalizarse (QK-111).
 *
 * Token ausente, inválido o vencido = visitante: `request.user` queda
 * `undefined` y la request sigue, nunca un 401. Un token vencido no puede
 * frenar una donación que el visitante igual podría hacer sin sesión; lo único
 * que pierde es la asociación. Por eso tampoco se distingue el motivo: para la
 * ruta, todo lo que no es un usuario válido es "sin sesión".
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser | false): TUser {
    return (user || undefined) as TUser;
  }
}
