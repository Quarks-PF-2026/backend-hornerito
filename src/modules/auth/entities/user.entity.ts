import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tipo de cuenta elegido al registrarse. Separa a quien solo dona (la mayoría)
 * de quien gestiona una organización: un donante no puede crear una
 * organización, y lo que declara una cuenta de organización no cuenta como
 * donación personal. Ser miembro de una organización no cambia el tipo: un
 * donante invitado sigue siendo donante.
 */
export enum AccountType {
  DONOR = 'donor',
  ORGANIZATION = 'organization',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  // Perfil (QK-11): dato editable por el propio usuario, fuera del alcance
  // de la organización — por eso vive en la tabla global, no en la membresía.
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column()
  passwordHash: string;

  @Column({ default: false })
  emailVerified: boolean;

  // Rol de plataforma, aparte de los roles de organización (ver
  // OrganizationMembershipRole): audita y valida/rechaza organizaciones vía
  // `/admin/organizations`. Se asigna directamente en la base.
  @Column({ default: false })
  isPlatformAdmin: boolean;

  @Column({ type: 'enum', enum: AccountType, default: AccountType.DONOR })
  accountType: AccountType;

  @Column({ type: 'varchar', nullable: true })
  verificationToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verificationTokenExpiresAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  resetPasswordToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetPasswordTokenExpiresAt: Date | null;

  @Column({ type: 'timestamptz' })
  termsAcceptedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
