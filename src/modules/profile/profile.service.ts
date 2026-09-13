import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { IUserRepository } from '../auth/repositories/user-repository.interface';
import { USER_REPOSITORY } from '../auth/repositories/user-repository.interface';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Mismo costo que auth.service.ts: si cambia allá, tiene que cambiar acá
// también para que un hash generado por cualquiera de los dos flujos sea
// comparable con bcrypt.compare sin distinción.
const PASSWORD_SALT_ROUNDS = 10;

export interface ProfileResult {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

// El perfil es de la persona (tabla `users`), no de la membresía a una
// organización: por eso este servicio no pasa por TenantContextService ni
// necesita organizationId. Los endpoints siempre operan sobre el usuario del
// JWT (nunca un id recibido por parámetro), así que no hay riesgo de leer o
// escribir el perfil de otra persona.
@Injectable()
export class ProfileService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
  ) {}

  private async getUserOrFail(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      // El JWT ya pasó JwtAuthGuard: si el usuario no existe más, la sesión
      // quedó huérfana (cuenta borrada). Mismo criterio que switchOrg.
      throw new UnauthorizedException();
    }
    return user;
  }

  async getProfile(userId: string): Promise<ProfileResult> {
    const user = await this.getUserOrFail(userId);
    return this.toProfileResult(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResult> {
    const user = await this.getUserOrFail(userId);

    user.name = dto.name;
    // `phone` distingue "no vino en el body" (undefined: no tocar) de
    // "vino en null" (el usuario quiere borrar el teléfono a propósito).
    if (dto.phone !== undefined) {
      user.phone = dto.phone;
    }

    const saved = await this.userRepository.save(user);
    return this.toProfileResult(saved);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }

    const user = await this.getUserOrFail(userId);

    const currentPasswordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      // 400 y no 401: el front interpreta un 401 como sesión vencida y
      // redirige al login, pero acá la sesión es válida — solo el dato que
      // el usuario tipeó está mal.
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }

    user.passwordHash = await bcrypt.hash(
      dto.newPassword,
      PASSWORD_SALT_ROUNDS,
    );
    // No se toca ningún token/versión de sesión: los JWT ya emitidos siguen
    // valiendo hasta que expiren por su cuenta (decisión de negocio QK-11).
    await this.userRepository.save(user);

    return { message: 'Contraseña actualizada correctamente.' };
  }

  private toProfileResult(user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  }): ProfileResult {
    // Nunca se devuelve passwordHash, tokens de verificación/reset ni
    // isPlatformAdmin: el perfil no es el lugar para exponer eso.
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    };
  }
}
