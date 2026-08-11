import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { IUserRepository } from '../repositories/user-repository.interface';
import { USER_REPOSITORY } from '../repositories/user-repository.interface';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

interface PlatformAdminGuardedRequest {
  user?: AuthenticatedUser;
}

/**
 * Puerta para `/admin/*`: rol de plataforma, aparte de los roles de
 * organización. Igual que TenantGuard con la membresía, relee el flag desde
 * la base en cada request (no viaja en el JWT) para que revocarlo surta
 * efecto sin esperar a que expire el token.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAdminGuardedRequest>();
    const userId = request.user?.id;
    const user = userId ? await this.userRepository.findById(userId) : null;
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException(
        'Esta acción requiere permisos de administrador de la plataforma.',
      );
    }
    return true;
  }
}