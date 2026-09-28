import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrganizationMembership } from '../../organization/entities/organization-membership.entity';

interface MembershipScopedRequest {
  membership: OrganizationMembership;
}

export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMembership => {
    const request = ctx.switchToHttp().getRequest<MembershipScopedRequest>();
    return request.membership;
  },
);
