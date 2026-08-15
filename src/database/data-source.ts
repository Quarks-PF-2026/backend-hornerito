import 'dotenv/config';
import { DataSource } from 'typeorm';
import { CollectionPoint } from '../modules/collection-point/entities/collection-point.entity';
import { Media } from '../modules/media/entities/media.entity';
import { Need } from '../modules/need/entities/need.entity';
import { Organization } from '../modules/organization/entities/organization.entity';
import { OrganizationInvitation } from '../modules/organization/entities/organization-invitation.entity';
import { OrganizationMembership } from '../modules/organization/entities/organization-membership.entity';
import { Post } from '../modules/post/entities/post.entity';
import { Supply } from '../modules/supply/entities/supply.entity';
import { User } from '../modules/auth/entities/user.entity';
import { VolunteerApplication } from '../modules/volunteering/entities/volunteer-application.entity';
import { VolunteerOpportunity } from '../modules/volunteering/entities/volunteer-opportunity.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  schema: 'public',
  entities: [
    User,
    Organization,
    OrganizationMembership,
    OrganizationInvitation,
    Supply,
    Need,
    Post,
    CollectionPoint,
    Media,
    VolunteerOpportunity,
    VolunteerApplication,
  ],
  migrations: [__dirname + '/migrations/public/*{.ts,.js}'],
  migrationsTableName: 'migrations',
});
