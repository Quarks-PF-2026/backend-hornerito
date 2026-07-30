import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrganizationMembership } from '../../organization/entities/organization-membership.entity';

export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMembership => {
    const request = ctx.switchToHttp().getRequest();
    return request.membership;
  },
);
