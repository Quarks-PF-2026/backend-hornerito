import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ default: false })
  emailVerified: boolean;

  // Rol de plataforma, aparte de los roles de organización (ver
  // OrganizationMembershipRole): audita y valida/rechaza organizaciones vía
  // `/admin/organizations`. Se asigna directamente en la base.
  @Column({ default: false })
  isPlatformAdmin: boolean;

  @Column({ type: 'varchar', nullable: true })
  verificationToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verificationTokenExpiresAt: Date | null;

  @Column({ type: 'timestamptz' })
  termsAcceptedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
