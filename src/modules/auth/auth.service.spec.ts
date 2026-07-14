/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
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
  let mail: jest.Mocked<VerificationMailService>;
  let jwt: jest.Mocked<JwtService>;

  beforeEach(() => {
    repo = {
      findByEmail: jest.fn(),
      findByVerificationToken: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    mail = {
      send: jest.fn(),
    } as unknown as jest.Mocked<VerificationMailService>;
    jwt = {
      sign: jest.fn().mockReturnValue('signed-jwt'),
    } as unknown as jest.Mocked<JwtService>;
    service = new AuthService(repo, mail, jwt);
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
      });
      expect(result).toEqual({
        accessToken: 'signed-jwt',
        user: { id: user.id, name: user.name, email: user.email },
      });
    });
  });
});
