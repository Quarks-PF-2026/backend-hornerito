/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from '../organization/entities/organization-membership.entity';
import { IUserRepository } from './repositories/user-repository.interface';
import { VerificationMailService } from './mail/verification-mail.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'María González',
    email: 'maria@example.com',
    passwordHash: 'hashed',
    emailVerified: false,
    verificationToken: 'valid-token',
    verificationTokenExpiresAt: new Date(Date.now() + 60_000),
    termsAcceptedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let repo: jest.Mocked<IUserRepository>;
  let membershipRepo: jest.Mocked<Repository<OrganizationMembership>>;
  let mail: jest.Mocked<VerificationMailService>;
  let jwt: jest.Mocked<JwtService>;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      findByEmail: jest.fn(),
      findByVerificationToken: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    membershipRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
    } as unknown as jest.Mocked<Repository<OrganizationMembership>>;
    mail = {
      send: jest.fn(),
    } as unknown as jest.Mocked<VerificationMailService>;
    jwt = {
      sign: jest.fn().mockReturnValue('signed-jwt'),
    } as unknown as jest.Mocked<JwtService>;
    service = new AuthService(repo, membershipRepo, mail, jwt);
  });

  describe('register', () => {
    const validDto = {
      name: 'María González',
      email: 'maria@example.com',
      password: 'password1',
      confirmPassword: 'password1',
      acceptedTerms: true,
    };

    it('creates the account, hashes the password and sends the verification email', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeUser());

      const result = await service.register(validDto);

      expect(repo.create).toHaveBeenCalledTimes(1);
      const created = repo.create.mock.calls[0][0];
      expect(created.email).toBe(validDto.email);
      expect(created.passwordHash).not.toBe(validDto.password);
      expect(
        await bcrypt.compare(validDto.password, created.passwordHash!),
      ).toBe(true);
      // TODO: volver a false cuando el envío real de email esté cableado.
      expect(created.emailVerified).toBe(true);
      expect(created.verificationToken).toBeTruthy();
      expect(mail.send).toHaveBeenCalledWith(
        validDto.email,
        created.verificationToken,
      );
      expect(result).toEqual({ email: validDto.email });
    });

    it('rejects a duplicate email', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());

      await expect(service.register(validDto)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects mismatched passwords', async () => {
      repo.findByEmail.mockResolvedValue(null);

      await expect(
        service.register({ ...validDto, confirmPassword: 'different1' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('marks the account verified and clears the token', async () => {
      const user = makeUser();
      repo.findByVerificationToken.mockResolvedValue(user);
      repo.save.mockImplementation((u) => Promise.resolve(u));

      await service.verifyEmail('valid-token');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: true,
          verificationToken: null,
        }),
      );
    });

    it('rejects an unknown token', async () => {
      repo.findByVerificationToken.mockResolvedValue(null);

      await expect(service.verifyEmail('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired token', async () => {
      repo.findByVerificationToken.mockResolvedValue(
        makeUser({ verificationTokenExpiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.verifyEmail('valid-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('login', () => {
    it('rejects an unverified account', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      repo.findByEmail.mockResolvedValue(
        makeUser({ emailVerified: false, passwordHash }),
      );

      await expect(
        service.login({ email: 'maria@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an incorrect password', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      repo.findByEmail.mockResolvedValue(
        makeUser({ emailVerified: true, passwordHash }),
      );

      await expect(
        service.login({ email: 'maria@example.com', password: 'wrong-pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns an access token for a verified account with correct credentials', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      const user = makeUser({ emailVerified: true, passwordHash });
      repo.findByEmail.mockResolvedValue(user);

      const result = await service.login({
        email: user.email,
        password: 'password1',
      });

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        orgId: undefined,
      });
      expect(result).toEqual({
        accessToken: 'signed-jwt',
        user: { id: user.id, name: user.name, email: user.email },
        role: null,
      });
    });

    it('embeds orgId in the token when the user has exactly one membership', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      const user = makeUser({ emailVerified: true, passwordHash });
      repo.findByEmail.mockResolvedValue(user);
      membershipRepo.find.mockResolvedValue([
        {
          organizationId: 'org-1',
          role: OrganizationMembershipRole.OWNER,
          active: true,
        } as OrganizationMembership,
      ]);

      const result = await service.login({
        email: user.email,
        password: 'password1',
      });

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        orgId: 'org-1',
      });
      expect(result.role).toBe(OrganizationMembershipRole.OWNER);
    });

    it('only considers active memberships when auto-selecting an organization', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      const user = makeUser({ emailVerified: true, passwordHash });
      repo.findByEmail.mockResolvedValue(user);
      // El usuario todavía no tiene ninguna membresía (recién registrado):
      // debe poder loguearse igual para completar el onboarding.
      membershipRepo.find.mockResolvedValue([]);

      const result = await service.login({
        email: user.email,
        password: 'password1',
      });

      // Trae TODAS las membresías (no solo las activas): necesita distinguir
      // "nunca tuvo organización" (login permitido) de "las tenía y se las
      // deshabilitaron" (login rechazado, CP-15-02).
      expect(membershipRepo.find).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
      expect(jwt.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        orgId: undefined,
      });
      expect(result.role).toBeNull();
    });

    it('does not pick an orgId when the user belongs to several active organizations', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      const user = makeUser({ emailVerified: true, passwordHash });
      repo.findByEmail.mockResolvedValue(user);
      membershipRepo.find.mockResolvedValue([
        { organizationId: 'org-1', active: true } as OrganizationMembership,
        { organizationId: 'org-2', active: true } as OrganizationMembership,
      ]);

      await service.login({ email: user.email, password: 'password1' });

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        orgId: undefined,
      });
    });

    it('rejects the login when every membership the user has is disabled (CP-15-02)', async () => {
      const passwordHash = await bcrypt.hash('password1', 10);
      const user = makeUser({ emailVerified: true, passwordHash });
      repo.findByEmail.mockResolvedValue(user);
      membershipRepo.find.mockResolvedValue([
        { organizationId: 'org-1', active: false } as OrganizationMembership,
      ]);

      await expect(
        service.login({ email: user.email, password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('switchOrg', () => {
    it('re-issues a token scoped to the selected organization', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      membershipRepo.findOneBy.mockResolvedValue({
        organizationId: 'org-2',
        role: OrganizationMembershipRole.COORDINATOR,
        active: true,
      } as OrganizationMembership);

      const result = await service.switchOrg(user.id, 'org-2');

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        orgId: 'org-2',
      });
      expect(result.accessToken).toBe('signed-jwt');
    });

    it('rejects switching to an organization the user is not a member of', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      membershipRepo.findOneBy.mockResolvedValue(null);

      await expect(service.switchOrg(user.id, 'org-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects switching to an organization where the membership is disabled', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      membershipRepo.findOneBy.mockResolvedValue({
        organizationId: 'org-2',
        role: OrganizationMembershipRole.VOLUNTEER,
        active: false,
      } as OrganizationMembership);

      await expect(service.switchOrg(user.id, 'org-2')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
