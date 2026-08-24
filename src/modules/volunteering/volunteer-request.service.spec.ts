import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { MailService } from '../mail/mail.service';
import { MemberService } from '../organization/member.service';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
} from '../organization/entities/organization-membership.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organization/entities/organization.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { VolunteerType } from '../volunteer-type/entities/volunteer-type.entity';
import { VolunteerOpportunity } from './entities/volunteer-opportunity.entity';
import {
  VolunteerRequest,
  VolunteerRequestStatus,
} from './entities/volunteer-request.entity';
import { VolunteerRequestService } from './volunteer-request.service';

const ORG_ID = 'org-1';

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: ORG_ID,
    name: 'Comedor Los Hornerito',
    status: OrganizationStatus.VALIDATED,
    seeksVolunteers: true,
    ...overrides,
  } as Organization;
}

describe('VolunteerRequestService', () => {
  let service: VolunteerRequestService;
  let sent: { to: string; subject: string; html: string; text: string }[];
  let saved: Partial<VolunteerRequest> | null;
  let mailShouldFail: boolean;

  function build(options: {
    organization?: Organization | null;
    volunteerType?: VolunteerType | null;
  }) {
    sent = [];
    saved = null;
    mailShouldFail = false;

    const requests = {
      create: (data: Partial<VolunteerRequest>) => data,
      save: (data: Partial<VolunteerRequest>) => {
        saved = data;
        return Promise.resolve({ id: 'req-1', ...data } as VolunteerRequest);
      },
    } as unknown as Repository<VolunteerRequest>;

    const organizations = {
      findOneBy: () =>
        Promise.resolve(
          options.organization === undefined
            ? makeOrganization()
            : options.organization,
        ),
    } as unknown as Repository<Organization>;

    const opportunities = {
      findOneBy: () => Promise.resolve(null),
    } as unknown as Repository<VolunteerOpportunity>;

    const volunteerTypes = {
      findOneBy: () => Promise.resolve(options.volunteerType ?? null),
    } as unknown as Repository<VolunteerType>;

    const memberships = {
      find: () =>
        Promise.resolve([
          {
            userId: 'owner-1',
            organizationId: ORG_ID,
            role: OrganizationMembershipRole.OWNER,
            active: true,
          },
        ] as OrganizationMembership[]),
    } as unknown as Repository<OrganizationMembership>;

    const users = {
      find: () =>
        Promise.resolve([
          { id: 'owner-1', email: 'duenio@example.com' },
        ] as User[]),
    } as unknown as Repository<User>;

    const mail = {
      send: (message: {
        to: string;
        subject: string;
        html: string;
        text: string;
      }) => {
        if (mailShouldFail) {
          return Promise.reject(new Error('SMTP caído'));
        }
        sent.push(message);
        return Promise.resolve();
      },
    } as unknown as MailService;

    return new VolunteerRequestService(
      requests,
      organizations,
      opportunities,
      volunteerTypes,
      memberships,
      users,
      {} as TenantContextService,
      {} as MemberService,
      mail,
      new ConfigService(),
    );
  }

  it('registra la solicitud como pendiente y normaliza el correo', async () => {
    service = build({});

    const result = await service.submit(ORG_ID, {
      name: '  Ana Gómez  ',
      email: '  ANA@Example.COM ',
      phone: ' 3511234567 ',
    });

    expect(result).toEqual({
      id: 'req-1',
      status: VolunteerRequestStatus.PENDING,
    });
    expect(saved).toMatchObject({
      organizationId: ORG_ID,
      name: 'Ana Gómez',
      email: 'ana@example.com',
      phone: '3511234567',
      message: null,
      status: VolunteerRequestStatus.PENDING,
    });
  });

  it('manda el acuse al postulante y el aviso a quien gestiona la organización', async () => {
    service = build({});

    await service.submit(ORG_ID, { name: 'Ana', email: 'ana@example.com' });

    expect(sent.map((message) => message.to)).toEqual([
      'ana@example.com',
      'duenio@example.com',
    ]);
    expect(sent[0].subject).toContain('Recibimos tu solicitud');
    expect(sent[1].subject).toContain('Nueva solicitud de voluntario');
    expect(sent[1].html).toContain('Ana');
  });

  it('persiste la solicitud aunque falle el envío de correo', async () => {
    service = build({});
    mailShouldFail = true;

    const result = await service.submit(ORG_ID, {
      name: 'Ana',
      email: 'ana@example.com',
    });

    expect(result.id).toBe('req-1');
    expect(saved).not.toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('rechaza postularse a una actividad y a un tipo al mismo tiempo', async () => {
    service = build({});

    await expect(
      service.submit(ORG_ID, {
        name: 'Ana',
        email: 'ana@example.com',
        opportunityId: 'opp-1',
        volunteerTypeId: 'type-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no expone una organización que todavía no fue validada', async () => {
    service = build({
      organization: makeOrganization({ status: OrganizationStatus.PENDING }),
    });

    await expect(
      service.submit(ORG_ID, { name: 'Ana', email: 'ana@example.com' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no acepta un tipo de voluntariado que no existe o está inactivo', async () => {
    service = build({ volunteerType: null });

    await expect(
      service.submit(ORG_ID, {
        name: 'Ana',
        email: 'ana@example.com',
        volunteerTypeId: 'type-inexistente',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
