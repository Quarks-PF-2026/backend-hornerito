import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from '../../organization/entities/organization-membership.entity';
import { RolesGuard } from './roles.guard';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function membership(role: OrganizationMembershipRole): OrganizationMembership {
  return { role, active: true } as OrganizationMembership;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('allows the handler when no roles are declared', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext({
      membership: membership(OrganizationMembershipRole.VOLUNTEER),
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a membership whose role is in the list', () => {
    reflector.getAllAndOverride.mockReturnValue([
      OrganizationMembershipRole.OWNER,
      OrganizationMembershipRole.ADMIN,
    ]);
    const ctx = makeContext({
      membership: membership(OrganizationMembershipRole.ADMIN),
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a role that is not in the list', () => {
    reflector.getAllAndOverride.mockReturnValue([
      OrganizationMembershipRole.OWNER,
      OrganizationMembershipRole.ADMIN,
    ]);
    const ctx = makeContext({
      membership: membership(OrganizationMembershipRole.VOLUNTEER),
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when the request carries no membership', () => {
    reflector.getAllAndOverride.mockReturnValue([
      OrganizationMembershipRole.OWNER,
    ]);

    expect(() => guard.canActivate(makeContext({}))).toThrow(
      ForbiddenException,
    );
  });
});
