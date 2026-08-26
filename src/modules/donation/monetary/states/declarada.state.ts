import { MonetaryDonation } from '../../entities/monetary-donation.entity';
import { MonetaryDonationStatus } from '../../entities/monetary-donation.entity';
import { MonetaryDonationState } from './monetary-donation-state';

/**
 * Único estado que transiciona: el donante ya declaró y la organización todavía
 * no se expidió.
 */
export const declaradaState: MonetaryDonationState = {
  confirm(donation: MonetaryDonation, userId: string): void {
    donation.status = MonetaryDonationStatus.CONFIRMADA;
    donation.decidedByUserId = userId;
    donation.decidedAt = new Date();
    donation.rejectReason = null;
  },

  reject(donation: MonetaryDonation, userId: string, reason: string): void {
    donation.status = MonetaryDonationStatus.RECHAZADA;
    donation.decidedByUserId = userId;
    donation.decidedAt = new Date();
    donation.rejectReason = reason;
  },
};
