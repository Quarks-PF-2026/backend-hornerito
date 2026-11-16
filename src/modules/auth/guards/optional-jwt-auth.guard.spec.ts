import { UnauthorizedException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('dado un token válido, cuando passport resuelve el usuario, entonces lo deja en la request', () => {
    const user = { id: 'user-1', email: 'ana@mail.com' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('dado un token ausente, inválido o vencido, cuando passport no resuelve usuario, entonces sigue como visitante sin lanzar', () => {
    expect(guard.handleRequest(null, false)).toBeUndefined();
    expect(
      guard.handleRequest(new UnauthorizedException('jwt expired'), false),
    ).toBeUndefined();
  });
});
