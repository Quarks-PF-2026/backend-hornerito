/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { IUserRepository } from '../auth/repositories/user-repository.interface';
import { User } from '../auth/entities/user.entity';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import { MemberService } from './member.service';
import { IOrganizationInvitationRepository } from './repositories/organization-invitation-repository.interface';
import { IOrganizationMembershipRepository } from './repositories/organization-membership-repository.interface';
import { IOrganizationRepository } from './repositories/organization-repository.interface';

const ORG_ID = 'org-1';
const ADMIN_ID = 'admin-1';

function makeMembership(
  overrides: Partial<OrganizationMembership> = {},
): OrganizationMembership {
  return {
    id: 'membership-1',
    userId: 'user-2',
    organizationId: ORG_ID,
    role: OrganizationMembershipRole.VOLUNTEER,
    active: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-2',
    name: 'Juan Pérez',
    email: 'juan@example.com',
    ...overrides,
  } as User;
}

describe('MemberService', () => {
  let service: MemberService;
  let membershipRepo: jest.Mocked<IOrganizationMembershipRepository>;
  let invitationRepo: jest.Mocked<IOrganizationInvitationRepository>;
  let organizationRepo: jest.Mocked<IOrganizationRepository>;
  let userRepo: jest.Mocked<IUserRepository>;
  let mail: jest.Mocked<MailService>;

  beforeEach(() => {
    membershipRepo = {
      findByUserId: jest.fn(),
      findByUserAndOrganization: jest.fn(),
      findByOrganizationId: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      save: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
    };
    invitationRepo = {
      findPendingByOrganization: jest.fn().mockResolvedValue([]),
      findPendingByToken: jest.fn(),
      findPendingByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((invitation: Partial<OrganizationInvitation>) =>
          Promise.resolve({
            id: 'invitation-1',
            createdAt: new Date(),
            ...invitation,
          } as OrganizationInvitation),
        ),
      save: jest.fn(),
      deleteById: jest.fn(),
    };
    organizationRepo = {
      findById: jest.fn().mockResolvedValue({ id: ORG_ID, name: 'ONG Sur' }),
      findByIds: jest.fn(),
      save: jest.fn(),
      deleteById: jest.fn(),
    };
    userRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([makeUser()]),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByVerificationToken: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    mail = { send: jest.fn() } as unknown as jest.Mocked<MailService>;

    service = new MemberService(
      membershipRepo,
      invitationRepo,
      organizationRepo,
      userRepo,
      mail,
      new ConfigService({ APP_BASE_URL: 'http://localhost:4200' }),
    );
  });

  describe('list', () => {
    it('joins each membership with its user', async () => {
      membershipRepo.findByOrganizationId.mockResolvedValue([makeMembership()]);

      const result = await service.list(ORG_ID);

      expect(result).toEqual([
        expect.objectContaining({
          userId: 'user-2',
          name: 'Juan Pérez',
          email: 'juan@example.com',
          role: OrganizationMembershipRole.VOLUNTEER,
          active: true,
        }),
      ]);
    });
  });

  describe('changeRole', () => {
    it('persists the new role', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue(
        makeMembership(),
      );

      const result = await service.changeRole(
        ORG_ID,
        ADMIN_ID,
        'user-2',
        OrganizationMembershipRole.COORDINATOR,
      );

      expect(membershipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          role: OrganizationMembershipRole.COORDINATOR,
        }),
      );
      expect(result.role).toBe(OrganizationMembershipRole.COORDINATOR);
    });

    it('refuses to touch the organization owner', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue(
        makeMembership({ role: OrganizationMembershipRole.OWNER }),
      );

      await expect(
        service.changeRole(
          ORG_ID,
          ADMIN_ID,
          'user-2',
          OrganizationMembershipRole.VOLUNTEER,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(membershipRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to change your own role', async () => {
      await expect(
        service.changeRole(
          ORG_ID,
          ADMIN_ID,
          ADMIN_ID,
          OrganizationMembershipRole.VOLUNTEER,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(membershipRepo.findByUserAndOrganization).not.toHaveBeenCalled();
    });

    it('rejects a user that does not belong to the organization', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue(null);

      await expect(
        service.changeRole(
          ORG_ID,
          ADMIN_ID,
          'user-9',
          OrganizationMembershipRole.VOLUNTEER,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleActive', () => {
    it('flips the active flag', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue(
        makeMembership({ active: true }),
      );

      const result = await service.toggleActive(ORG_ID, ADMIN_ID, 'user-2');

      expect(result.active).toBe(false);
      expect(membershipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ active: false }),
      );
    });

    it('refuses to disable yourself', async () => {
      await expect(
        service.toggleActive(ORG_ID, ADMIN_ID, ADMIN_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('invite', () => {
    it('stores a pending invitation and sends the email', async () => {
      const result = await service.invite(ORG_ID, ADMIN_ID, {
        email: '  Juan@Example.com ',
        role: OrganizationMembershipRole.COORDINATOR,
      });

      expect(invitationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          email: 'juan@example.com',
          role: OrganizationMembershipRole.COORDINATOR,
          invitedByUserId: ADMIN_ID,
          acceptedAt: null,
        }),
      );
      expect(mail.send).toHaveBeenCalledTimes(1);
      const message = mail.send.mock.calls[0][0];
      expect(message.to).toBe('juan@example.com');
      expect(message.html).toContain('/invitacion?token=');
      expect(result.email).toBe('juan@example.com');
    });

    it('rejects a user that is already a member', async () => {
      userRepo.findByEmail.mockResolvedValue(makeUser());
      membershipRepo.findByUserAndOrganization.mockResolvedValue(
        makeMembership(),
      );

      await expect(
        service.invite(ORG_ID, ADMIN_ID, {
          email: 'juan@example.com',
          role: OrganizationMembershipRole.VOLUNTEER,
        }),
      ).rejects.toThrow(ConflictException);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('rejects a duplicate pending invitation', async () => {
      invitationRepo.findPendingByEmail.mockResolvedValue(
        {} as OrganizationInvitation,
      );

      await expect(
        service.invite(ORG_ID, ADMIN_ID, {
          email: 'juan@example.com',
          role: OrganizationMembershipRole.VOLUNTEER,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelInvitation', () => {
    it('refuses to cancel an invitation of another organization', async () => {
      invitationRepo.findById.mockResolvedValue({
        id: 'invitation-1',
        organizationId: 'other-org',
      } as OrganizationInvitation);

      await expect(
        service.cancelInvitation(ORG_ID, 'invitation-1'),
      ).rejects.toThrow(NotFoundException);
      expect(invitationRepo.deleteById).not.toHaveBeenCalled();
    });
  });
});
