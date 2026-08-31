/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObjectLiteral } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../auth/entities/user.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { OrganizationInvitation } from './entities/organization-invitation.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/organization-membership.entity';
import { Organization } from './entities/organization.entity';
import { MemberService } from './member.service';

const ORG_ID = 'org-1';
const ADMIN_ID = 'admin-1';

/**
 * `MemberService` arma sus repositorios al vuelo sobre el manager del tenant,
 * así que el doble tiene que resolver por entidad: un solo repo genérico haría
 * que `invite` leyera invitaciones donde busca usuarios.
 */
type RepoMock = {
  find: jest.Mock;
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};

function makeRepoMock(): RepoMock {
  return {
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn((entity: ObjectLiteral) => entity),
    save: jest.fn((entity: ObjectLiteral) => Promise.resolve(entity)),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

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
  let membershipRepo: RepoMock;
  let invitationRepo: RepoMock;
  let organizationRepo: RepoMock;
  let userRepo: RepoMock;
  let mail: jest.Mocked<MailService>;

  beforeEach(() => {
    membershipRepo = makeRepoMock();
    invitationRepo = makeRepoMock();
    organizationRepo = makeRepoMock();
    userRepo = makeRepoMock();

    organizationRepo.findOneBy.mockResolvedValue({
      id: ORG_ID,
      name: 'ONG Sur',
    });
    userRepo.findBy.mockResolvedValue([makeUser()]);
    invitationRepo.save.mockImplementation(
      (invitation: Partial<OrganizationInvitation>) =>
        Promise.resolve({
          id: 'invitation-1',
          createdAt: new Date(),
          ...invitation,
        } as OrganizationInvitation),
    );

    const repos = new Map<unknown, RepoMock>([
      [OrganizationMembership, membershipRepo],
      [OrganizationInvitation, invitationRepo],
      [Organization, organizationRepo],
      [User, userRepo],
    ]);

    mail = { send: jest.fn() } as unknown as jest.Mocked<MailService>;

    const tenantContext = {
      organizationId: ORG_ID,
      getManager: jest.fn().mockReturnValue({
        getRepository: (entity: unknown) => repos.get(entity),
      }),
    } as unknown as jest.Mocked<TenantContextService>;

    service = new MemberService(
      tenantContext,
      mail,
      new ConfigService({ APP_BASE_URL: 'http://localhost:4200' }),
    );
  });

  describe('list', () => {
    it('joins each membership with its user', async () => {
      membershipRepo.find.mockResolvedValue([makeMembership()]);

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
      membershipRepo.findOneBy.mockResolvedValue(makeMembership());

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
      membershipRepo.findOneBy.mockResolvedValue(
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
      expect(membershipRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('rejects a user that does not belong to the organization', async () => {
      membershipRepo.findOneBy.mockResolvedValue(null);

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
      membershipRepo.findOneBy.mockResolvedValue(
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

      expect(invitationRepo.save).toHaveBeenCalledWith(
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
      userRepo.findOneBy.mockResolvedValue(makeUser());
      membershipRepo.findOneBy.mockResolvedValue(makeMembership());

      await expect(
        service.invite(ORG_ID, ADMIN_ID, {
          email: 'juan@example.com',
          role: OrganizationMembershipRole.VOLUNTEER,
        }),
      ).rejects.toThrow(ConflictException);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('rejects a duplicate pending invitation', async () => {
      invitationRepo.findOneBy.mockResolvedValue({});

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
      invitationRepo.findOneBy.mockResolvedValue({
        id: 'invitation-1',
        organizationId: 'other-org',
      });

      await expect(
        service.cancelInvitation(ORG_ID, 'invitation-1'),
      ).rejects.toThrow(NotFoundException);
      expect(invitationRepo.delete).not.toHaveBeenCalled();
    });
  });
});
