import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tipos con los que arranca toda organización (QK-33). La migración siembra
 * las que ya existían y `OrganizationService.createMine` las nuevas, así que
 * esta constante es la única fuente de verdad de esa lista.
 */
export const DEFAULT_VOLUNTEER_TYPES = [
  'Cocina',
  'Reparto',
  'Logística',
  'Limpieza',
  'Apoyo escolar',
];

@Entity('volunteer_types')
// Destino de la FK compuesta de `VolunteerOpportunity`: una oportunidad solo
// puede apuntar a un tipo de su misma organización.
@Unique('UQ_volunteer_types_org_id', ['organizationId', 'id'])
export class VolunteerType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column()
  name: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
