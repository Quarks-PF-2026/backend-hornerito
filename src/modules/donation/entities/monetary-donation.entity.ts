import { ChildEntity, Column } from 'typeorm';
import { Donation, DonationKind } from './donation.entity';

export enum MonetaryDonationStatus {
  /** El donante dice que transfirió; la organización todavía no lo verificó. */
  DECLARADA = 'declarada',
  CONFIRMADA = 'confirmada',
  RECHAZADA = 'rechazada',
}

export enum DonationMethod {
  TRANSFERENCIA = 'transferencia',
  /**
   * Contemplado en el modelo pero todavía no implementado: el service lo
   * rechaza con 501. Ver `MonetaryDonationService.declare`.
   */
  MERCADOPAGO = 'mercadopago',
}

/** TypeORM devuelve `decimal` como string; lo normalizamos a number. */
const decimalToNumber = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/** Monto mínimo aceptado, en pesos. Debajo de esto no compensa el movimiento. */
export const MIN_DONATION_AMOUNT = 100;

/**
 * Donación económica (QK-20): la declara el donante desde la ficha pública,
 * sin cuenta y anónimo si quiere, después de transferir por fuera del sistema.
 * Un owner o admin confirma o rechaza la recepción contra el extracto.
 *
 * A diferencia de la presencial, sí tiene ciclo de vida, y las transiciones
 * viven en `monetary/states/` (patrón State) en vez de en el service.
 *
 * `donorContact` —heredado— guarda el email del donante cuando lo deja: es
 * opcional, y sin él la donación es anónima y no recibe aviso.
 */
@ChildEntity(DonationKind.ECONOMICA)
export class MonetaryDonation extends Donation {
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: decimalToNumber,
  })
  amount: number;

  @Column({ type: 'enum', enum: MonetaryDonationStatus })
  status: MonetaryDonationStatus;

  @Column({ type: 'enum', enum: DonationMethod })
  method: DonationMethod;

  /** Número de operación del banco, como lo copió el donante. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  operationNumber: string | null;

  @Column({ type: 'text', nullable: true })
  receiptUrl: string | null;

  /** Id del asset en Cloudinary, para poder borrarlo. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  receiptPublicId: string | null;

  /** Id del pago en la pasarela. Null mientras el método sea transferencia. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  externalPaymentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  rejectReason: string | null;
}
