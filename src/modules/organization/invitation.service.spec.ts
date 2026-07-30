/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth/auth.service';
import { User } from '../auth/entities/user.entity';
import { IUserRepository } from '../auth/repositories/user-repository.interface';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import { InvitationService } from './invitation.service';
import { IOrganizationInvitationRepository } from './repositories/organization-invitation-repository.interface';
import { IOrganizationMembershipRepository } from './repositories/organization-membership-repository.interface';
import { IOrganizationRepository } from './repositories/organization-repository.interface';

function makeInvitation(
  overrides: Partial<OrganizationInvitation> = {},
): OrganizationInvitation {
  return {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'juan@example.com',
    role: OrganizationMembershipRole.COORDINATOR,
    token: 'token-1',
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    invitedByUserId: 'admin-1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('InvitationService', () => {
  let service: InvitationService;
  let invitationRepo: jest.Mocked<IOrganizationInvitationRepository>;
  let membershipRepo: jest.Mocked<IOrganizationMembershipRepository>;
  let organizationRepo: jest.Mocked<IOrganizationRepository>;
  let userRepo: jest.Mocked<IUserRepository>;
  let authService: jest.Mocked<AuthService>;

  beforeEach(() => {
    invitationRepo = {
      findPendingByOrganization: jest.fn(),
      findPendingByToken: jest.fn().mockResolvedValue(makeInvitation()),
      findPendingByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      save: jest.fn().mockImplementation((i: unknown) => Promise.resolve(i)),
      deleteById: jest.fn(),
    };
    membershipRepo = {
      findByUserId: jest.fn(),
      findByUserAndOrganization: jest.fn().mockResolvedValue(null),
      findByOrganizationId: jest.fn(),
      create: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
      save: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
    };
    organizationRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'org-1', name: 'ONG Sur' }),
      findByIds: jest.fn(),
      save: jest.fn(),
      deleteById: jest.fn(),
    };
    userRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByVerificationToken: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((user: Partial<User>) =>
          Promise.resolve({ id: 'user-9', ...user } as User),
        ),
      save: jest.fn(),
    };
    authService = {
      issueAccessToken: jest.fn().mockReturnValue({
        accessToken: 'signed-jwt',
        user: { id: 'user-9', name: 'Juan', email: 'juan@example.com' },
        role: OrganizationMembershipRole.COORDINATOR,
      }),
    } as unknown as jest.Mocked<AuthService>;

    service = new InvitationService(
      invitationRepo,
      membershipRepo,
      organizationRepo,
      userRepo,
      authService,
    );
  });

  describe('preview', () => {
    it('returns the organization name and whether the account exists', async () => {
      const result = await service.preview('token-1');

      expect(result).toEqual({
        organizationName: 'ONG Sur',
        email: 'juan@example.com',
        role: OrganizationMembershipRole.COORDINATOR,
        userExists: false,
      });
    });

    it('rejects an unknown or already used token', async () => {
      invitationRepo.findPendingByToken.mockResolvedValue(null);

      await expect(service.preview('nope')).rejects.toThrow(NotFoundException);
    });

    it('rejects an expired invitation', async () => {
      invitationRepo.findPendingByToken.mockResolvedValue(
        makeInvitation({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.preview('token-1')).rejects.toThrow(GoneException);
    });
  });

  describe('accept', () => {
    it('creates the account and the membership when the email has no user', async () => {
      const result = await service.accept('token-1', {
        name: 'Juan Pérez',
        password: 'password1',
      });

      const created = userRepo.create.mock.calls[0][0];
      expect(created.email).toBe('juan@example.com');
      expect(created.emailVerified).toBe(true);
      expect(await bcrypt.compare('password1', created.passwordHash!)).toBe(
        true,
      );
      expect(membershipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          role: OrganizationMembershipRole.COORDINATOR,
          active: true,
        }),
      );
      expect(invitationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining<Partial<OrganizationInvitation>>({
          acceptedAt: expect.any(Date) as Date,
        }),
      );
      expect(result.accessToken).toBe('signed-jwt');
      expect(result.organizationId).toBe('org-1');
    });

    it('only links the membership when the account already exists', async () => {
      userRepo.findByEmail.mockResolvedValue({
        id: 'user-3',
        email: 'juan@example.com',
      } as User);

      await service.accept('token-1', {});

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(membershipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-3' }),
      );
    });

    it('reactivates an existing membership instead of duplicating it', async () => {
      userRepo.findByEmail.mockResolvedValue({
        id: 'user-3',
        email: 'juan@example.com',
      } as User);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({
        userId: 'user-3',
        organizationId: 'org-1',
        role: OrganizationMembershipRole.VOLUNTEER,
        active: false,
      } as OrganizationMembership);

      await service.accept('token-1', {});

      expect(membershipRepo.create).not.toHaveBeenCalled();
      expect(membershipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          active: true,
          role: OrganizationMembershipRole.COORDINATOR,
        }),
      );
    });

    it('requires name and password for a brand new account', async () => {
      await expect(service.accept('token-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(userRepo.create).not.toHaveBeenCalled();
    });
  });
});
