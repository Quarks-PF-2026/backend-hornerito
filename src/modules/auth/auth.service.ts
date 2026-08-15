import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from '../organization/entities/organization-membership.entity';
import { User } from './entities/user.entity';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { IUserRepository } from './repositories/user-repository.interface';
import { USER_REPOSITORY } from './repositories/user-repository.interface';
import { PasswordResetMailService } from './mail/password-reset-mail.service';
import { VerificationMailService } from './mail/verification-mail.service';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const PASSWORD_SALT_ROUNDS = 10;

export interface RegisterResult {
  email: string;
}

export interface LoginResult {
  accessToken: string;
  user: { id: string; name: string; email: string };
  role: OrganizationMembershipRole | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepository: Repository<OrganizationMembership>,
    private readonly verificationMailService: VerificationMailService,
    private readonly passwordResetMailService: PasswordResetMailService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResult> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }

    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Este correo ya está en uso.');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    const verificationToken = randomUUID();

    const user = await this.userRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      emailVerified: false,
      verificationToken,
      verificationTokenExpiresAt: new Date(
        Date.now() + VERIFICATION_TOKEN_TTL_MS,
      ),
      termsAcceptedAt: new Date(),
    });

    await this.verificationMailService.send(user.email, verificationToken);

    return { email: user.email };
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.userRepository.findByVerificationToken(token);
    if (!user) {
      throw new BadRequestException('El enlace de verificación no es válido.');
    }
    if (
      !user.verificationTokenExpiresAt ||
      user.verificationTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('El enlace de verificación expiró.');
    }

    user.emailVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpiresAt = null;
    await this.userRepository.save(user);
  }

  /**
   * Reenvía el correo de verificación. Como `forgotPassword`, responde
   * siempre igual: quien pregunta no puede deducir si el correo existe.
   */
  async resendVerification(
    dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (user && !user.emailVerified) {
      const verificationToken = randomUUID();
      user.verificationToken = verificationToken;
      user.verificationTokenExpiresAt = new Date(
        Date.now() + VERIFICATION_TOKEN_TTL_MS,
      );
      await this.userRepository.save(user);
      await this.verificationMailService.send(user.email, verificationToken);
    }
    return {
      message:
        'Si el correo está registrado y sin verificar, te enviamos un nuevo enlace.',
    };
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    if (!user.emailVerified) {
      throw new UnauthorizedException({
        message: 'Verificá tu cuenta antes de iniciar sesión.',
        unverified: true,
      });
    }

    // Una membresía deshabilitada no cuenta: el usuario no entra a esa
    // organización aunque siga teniendo cuenta.
    const allMemberships = await this.membershipRepository.find({
      where: { userId: user.id },
    });
    const activeMemberships = allMemberships.filter((m) => m.active);

    // Si el usuario tiene al menos una membresía y NINGUNA está activa, es
    // que un administrador lo deshabilitó explícitamente: se le rechaza el
    // login (CP-15-02). Un usuario sin ninguna membresía todavía (recién
    // registrado, sin organización creada) sí puede loguearse con
    // normalidad para completar su onboarding.
    if (allMemberships.length > 0 && activeMemberships.length === 0) {
      throw new UnauthorizedException(
        'Tu cuenta está deshabilitada. Contactá a un administrador.',
      );
    }

    const only =
      activeMemberships.length === 1 ? activeMemberships[0] : undefined;

    return this.issueAccessToken(user, only?.organizationId, only?.role);
  }

  async switchOrg(
    userId: string,
    organizationId: string,
  ): Promise<LoginResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    const membership = await this.membershipRepository.findOneBy({
      userId,
      organizationId,
    });
    if (!membership) {
      throw new ForbiddenException('No pertenecés a esa organización.');
    }
    if (!membership.active) {
      throw new ForbiddenException(
        'Tu acceso a esta organización está deshabilitado.',
      );
    }

    return this.issueAccessToken(user, organizationId, membership.role);
  }

  /**
   * Firma el token de la sesión. El rol viaja en la respuesta (para que el
   * frontend arme el menú) pero NO en el payload del JWT: la autorización lo
   * relee de la base en cada request vía TenantGuard.
   */
  issueAccessToken(
    user: User,
    orgId?: string,
    role?: OrganizationMembershipRole,
  ): LoginResult {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      orgId,
    });
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email },
      role: role ?? null,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (user) {
      const resetPasswordToken = randomUUID();
      user.resetPasswordToken = resetPasswordToken;
      user.resetPasswordTokenExpiresAt = new Date(
        Date.now() + RESET_TOKEN_TTL_MS,
      );
      await this.userRepository.save(user);
      await this.passwordResetMailService.send(user.email, resetPasswordToken);
    }
    return {
      message:
        'Si el correo está registrado en nuestro sistema, recibirás un enlace de restablecimiento.',
    };
  }

  async verifyResetToken(token: string): Promise<void> {
    const user = await this.userRepository.findByResetPasswordToken(token);
    if (
      !user ||
      !user.resetPasswordTokenExpiresAt ||
      user.resetPasswordTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'El enlace de restablecimiento expiró o es inválido.',
      );
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }

    const user = await this.userRepository.findByResetPasswordToken(dto.token);
    if (
      !user ||
      !user.resetPasswordTokenExpiresAt ||
      user.resetPasswordTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'El enlace de restablecimiento expiró o es inválido.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    user.passwordHash = passwordHash;
    user.resetPasswordToken = null;
    user.resetPasswordTokenExpiresAt = null;

    await this.userRepository.save(user);
  }
}
