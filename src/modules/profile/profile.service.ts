import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import type { IUserRepository } from '../auth/repositories/user-repository.interface';
import { USER_REPOSITORY } from '../auth/repositories/user-repository.interface';
import { DonationKind } from '../donation/entities/donation.entity';
import {
  MonetaryDonation,
  MonetaryDonationStatus,
} from '../donation/entities/monetary-donation.entity';
import { Organization } from '../organization/entities/organization.entity';
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

export interface MyDonationView {
  id: string;
  organizationId: string;
  organizationName: string;
  amount: number;
  status: MonetaryDonationStatus;
  isAnonymous: boolean;
  createdAt: string;
}

// ponytail: límite fijo de 50, paginar cuando un donante supere ese número
const MY_DONATIONS_LIMIT = 50;

// El perfil es de la persona (tabla `users`), no de la membresía a una
// organización: por eso este servicio no pasa por TenantContextService ni
// necesita organizationId. Los endpoints siempre operan sobre el usuario del
// JWT (nunca un id recibido por parámetro), así que no hay riesgo de leer o
// escribir el perfil de otra persona.
@Injectable()
export class ProfileService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
    @InjectRepository(MonetaryDonation)
    private readonly donations: Repository<MonetaryDonation>,
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

  /**
   * "Mis donaciones" (QK-113): el historial privado no es el ranking público.
   * El ranking solo cuenta confirmadas y no anónimas; acá el donante ve todo lo
   * que declaró con sesión, incluidas anónimas, pendientes y rechazadas, porque
   * es su propia información y necesita seguir el estado de cada una.
   *
   * Cruza organizaciones, así que no hay tenant: corre como owner, igual que
   * `PublicService.countedDonations`, y `donations` no tiene FORCE RLS. Por eso
   * el filtro por donante y por variante va explícito: nada lo recorta después.
   */
  async listMyDonations(userId: string): Promise<MyDonationView[]> {
    const rows = await this.donations
      .createQueryBuilder('d')
      .innerJoin(Organization, 'o', 'o.id = d."organizationId"')
      .where('d."kind" = :kind', { kind: DonationKind.ECONOMICA })
      .andWhere('d."donorUserId" = :userId', { userId })
      .select('d.id', 'id')
      .addSelect('d."organizationId"', 'organizationId')
      .addSelect('o.name', 'organizationName')
      .addSelect('d.amount', 'amount')
      .addSelect('d.status', 'status')
      .addSelect('d."isAnonymous"', 'isAnonymous')
      .addSelect('d."createdAt"', 'createdAt')
      .orderBy('d."createdAt"', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .limit(MY_DONATIONS_LIMIT)
      .getRawMany<{
        id: string;
        organizationId: string;
        organizationName: string;
        amount: string;
        status: MonetaryDonationStatus;
        isAnonymous: boolean;
        createdAt: Date;
      }>();
    // getRawMany saltea el transformer de la entidad: el numeric llega string.
    return rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      createdAt: new Date(row.createdAt).toISOString(),
    }));
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
