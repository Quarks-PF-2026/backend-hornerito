/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mocks are safe to reference unbound */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { OrganizationMembership } from '../organization/entities/organization-membership.entity';
import { TenantGuard } from './tenant.guard';

const ACTIVE_MEMBERSHIP = {
  id: 'membership-1',
  userId: 'user-1',
  organizationId: 'org-1',
  active: true,
} as OrganizationMembership;

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let repo: jest.Mocked<Repository<Organization>>;
  let membershipRepo: jest.Mocked<Repository<OrganizationMembership>>;

  beforeEach(() => {
    repo = {
      findOneBy: jest.fn(),
    } as unknown as jest.Mocked<Repository<Organization>>;
    membershipRepo = {
      findOneBy: jest.fn().mockResolvedValue(ACTIVE_MEMBERSHIP),
    } as unknown as jest.Mocked<Repository<OrganizationMembership>>;
    guard = new TenantGuard(repo, membershipRepo);
  });

  it('rejects when the request has no orgId', async () => {
    const ctx = makeContext({ user: { id: 'user-1' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(repo.findOneBy).not.toHaveBeenCalled();
  });

  it('rejects when the organization does not exist', async () => {
    repo.findOneBy.mockResolvedValue(null);
    const ctx = makeContext({ user: { id: 'user-1', orgId: 'org-1' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the organization is pending', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.PENDING,
    } as Organization);
    const ctx = makeContext({ user: { id: 'user-1', orgId: 'org-1' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the organization is rejected', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.REJECTED,
    } as Organization);
    const ctx = makeContext({ user: { id: 'user-1', orgId: 'org-1' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows and attaches the organization when validated', async () => {
    const org = {
      id: 'org-1',
      status: OrganizationStatus.VALIDATED,
    } as Organization;
    repo.findOneBy.mockResolvedValue(org);
    const request: Record<string, unknown> = {
      user: { id: 'user-1', orgId: 'org-1' },
    };
    const ctx = makeContext(request);

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.organization).toBe(org);
    expect(request.membership).toBe(ACTIVE_MEMBERSHIP);
  });

  it('rejects when the user has no membership in the organization', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.VALIDATED,
    } as Organization);
    membershipRepo.findOneBy.mockResolvedValue(null);
    const ctx = makeContext({ user: { id: 'user-1', orgId: 'org-1' } });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the membership is disabled', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.VALIDATED,
    } as Organization);
    membershipRepo.findOneBy.mockResolvedValue({
      ...ACTIVE_MEMBERSHIP,
      active: false,
    });
    const ctx = makeContext({ user: { id: 'user-1', orgId: 'org-1' } });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
