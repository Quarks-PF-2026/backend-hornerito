import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../modules/auth/entities/user.entity';
import { Organization } from '../modules/organization/entities/organization.entity';
import { OrganizationMembership } from '../modules/organization/entities/organization-membership.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  schema: 'public',
  entities: [User, Organization, OrganizationMembership],
  migrations: [__dirname + '/migrations/public/*{.ts,.js}'],
  migrationsTableName: 'migrations',
});
