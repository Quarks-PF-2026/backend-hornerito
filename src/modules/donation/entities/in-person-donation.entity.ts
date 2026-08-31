import { ChildEntity, Column } from 'typeorm';
import { Donation, DonationKind } from './donation.entity';

/**
 * Donación presencial (QK-26): la carga la organización en el momento de
 * recibirla, no el donante. Por eso no tiene estados — nace recibida — y
 * `createdAt` es la fecha de la entrega. Los insumos que la componen viven en
 * `donation_items`.
 */
@ChildEntity(DonationKind.PRESENCIAL)
export class InPersonDonation extends Donation {
  /** Null si la donación no llegó a un punto (por ejemplo, a la sede). */
  @Column({ type: 'uuid', nullable: true })
  collectionPointId: string | null;
}
