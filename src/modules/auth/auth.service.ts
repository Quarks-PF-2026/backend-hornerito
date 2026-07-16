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
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { IUserRepository } from './repositories/user-repository.interface';
import { USER_REPOSITORY } from './repositories/user-repository.interface';
import { VerificationMailService } from './mail/verification-mail.service';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_SALT_ROUNDS = 10;

export interface RegisterResult {
  email: string;
}

export interface LoginResult {
  accessToken: string;
  user: { id: string; name: string; email: string };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepository: Repository<OrganizationMembership>,
    private readonly verificationMailService: VerificationMailService,
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
      // TODO: volver a `false` cuando el envío real de email esté cableado.
      emailVerified: true,
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

    const memberships = await this.membershipRepository.find({
      where: { userId: user.id },
    });
    const orgId =
      memberships.length === 1 ? memberships[0].organizationId : undefined;

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      orgId,
    });
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email },
    };
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

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      orgId: organizationId,
    });
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }
}
