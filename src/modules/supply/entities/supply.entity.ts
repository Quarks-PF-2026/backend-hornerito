import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum SupplyCategory {
  ALIMENTOS_SECOS = 'Alimentos secos',
  FRESCOS = 'Frescos',
  LIMPIEZA = 'Limpieza',
  HIGIENE = 'Higiene',
  BEBIDAS = 'Bebidas',
}

export enum SupplyUnit {
  KILOGRAMOS = 'Kilogramos',
  LITROS = 'Litros',
  UNIDADES = 'Unidades',
  PAQUETES = 'Paquetes',
  CAJAS = 'Cajas',
}

@Entity('supplies')
// Destino de la FK compuesta de `Need`: una necesidad solo puede apuntar a un
// insumo de su misma organización.
@Unique('UQ_supplies_org_id', ['organizationId', 'id'])
export class Supply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: SupplyCategory })
  category: SupplyCategory;

  @Column({ type: 'enum', enum: SupplyUnit })
  unit: SupplyUnit;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
