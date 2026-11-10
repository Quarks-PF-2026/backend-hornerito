import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
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
const MAIL_UNAVAILABLE_MESSAGE =
  'No pudimos enviar el correo en este momento. Probá de nuevo en unos minutos.';

export interface RegisterResult {
  email: string;
  verificationMailSent: boolean;
}

export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    isPlatformAdmin: boolean;
  };
  role: OrganizationMembershipRole | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

    // Si el correo falla (p. ej. el SMTP rechaza por límite diario) no se
    // propaga: la cuenta ya existe, y un 500 deja a la persona trabada porque
    // reintentar el registro da 409. El reenvío desde la pantalla de
    // verificación resuelve el caso; el flag le avisa al front que lo ofrezca.
    let verificationMailSent = true;
    try {
      await this.verificationMailService.send(user.email, verificationToken);
    } catch (err) {
      verificationMailSent = false;
      this.logMailFailure('verificación (registro)', user.email, err);
    }

    return { email: user.email, verificationMailSent };
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
      await this.sendOrUnavailable('verificación (reenvío)', user.email, () =>
        this.verificationMailService.send(user.email, verificationToken),
      );
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
   * Firma el token de la sesión. El rol y `isPlatformAdmin` viajan en la
   * respuesta (para que el frontend arme el menú) pero NO en el payload del
   * JWT: la autorización relee ambos de la base en cada request (TenantGuard
   * y PlatformAdminGuard), para que una baja de rol o de admin de plataforma
   * aplique sin esperar a que expire el token.
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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        // QK-11: trivial de agregar acá y evita que el front tenga que pegarle
        // a /profile solo para mostrar el teléfono después de loguear.
        phone: user.phone,
        isPlatformAdmin: user.isPlatformAdmin,
      },
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
      await this.sendOrUnavailable('restablecimiento', user.email, () =>
        this.passwordResetMailService.send(user.email, resetPasswordToken),
      );
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

  /**
   * En reenvío y olvidé-contraseña el correo ES el resultado del pedido: si
   * falla, se responde 503 con un mensaje accionable en vez de un 500 genérico.
   * Solo se llega acá cuando el usuario existe, así que con el SMTP caído la
   * diferencia 200/503 revela existencia; se acepta porque la alternativa es
   * mentir "te enviamos un enlace" cuando no salió nada.
   */
  private async sendOrUnavailable(
    kind: string,
    email: string,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.logMailFailure(kind, email, err);
      throw new ServiceUnavailableException(MAIL_UNAVAILABLE_MESSAGE);
    }
  }

  // Nunca loguear el token: con él se verifica la cuenta o se cambia la
  // contraseña. El error de nodemailer trae la respuesta SMTP, no el cuerpo.
  private logMailFailure(kind: string, email: string, err: unknown): void {
    this.logger.error(
      `Falló el envío del correo de ${kind} a ${email}`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
