import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OrganizationMembershipRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  COORDINATOR = 'coordinador',
  VOLUNTEER = 'voluntario',
}

// Roles que un administrador puede asignar desde el listado de usuarios.
// `owner` queda afuera: es el creador de la organización y no se transfiere.
export const ASSIGNABLE_ROLES = [
  OrganizationMembershipRole.ADMIN,
  OrganizationMembershipRole.COORDINATOR,
  OrganizationMembershipRole.VOLUNTEER,
];

// Roles que administran usuarios.
export const MEMBER_MANAGER_ROLES = [
  OrganizationMembershipRole.OWNER,
  OrganizationMembershipRole.ADMIN,
];

// Roles con permiso de escritura sobre el contenido de la organización
// (insumos, puntos, necesidades, publicaciones). El voluntario solo lee.
export const CONTENT_WRITER_ROLES = [
  OrganizationMembershipRole.OWNER,
  OrganizationMembershipRole.ADMIN,
  OrganizationMembershipRole.COORDINATOR,
];

@Entity('organization_memberships')
@Index(['userId', 'organizationId'], { unique: true })
export class OrganizationMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  organizationId: string;

  @Column({
    type: 'enum',
    enum: OrganizationMembershipRole,
    default: OrganizationMembershipRole.OWNER,
  })
  role: OrganizationMembershipRole;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
