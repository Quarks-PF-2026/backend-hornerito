import { MonetaryDonation } from '../../entities/monetary-donation.entity';

/**
 * Una transición del ciclo de vida de la donación económica.
 *
 * El estado actual decide qué se puede hacer, no el service: así una variante
 * nueva (por ejemplo `pendiente_de_pago`, cuando entre Mercado Pago) se agrega
 * escribiendo su propio objeto en vez de sumando otro `if` al service.
 *
 * Mutan la entidad en memoria; persistir es responsabilidad de quien llama.
 */
export interface MonetaryDonationState {
  confirm(donation: MonetaryDonation, userId: string): void;
  reject(donation: MonetaryDonation, userId: string, reason: string): void;
}
