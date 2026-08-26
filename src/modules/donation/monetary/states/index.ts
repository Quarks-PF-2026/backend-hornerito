import { MonetaryDonationStatus } from '../../entities/monetary-donation.entity';
import { confirmadaState, rechazadaState } from './decidida.state';
import { declaradaState } from './declarada.state';
import { MonetaryDonationState } from './monetary-donation-state';

const STATES: Record<MonetaryDonationStatus, MonetaryDonationState> = {
  [MonetaryDonationStatus.DECLARADA]: declaradaState,
  [MonetaryDonationStatus.CONFIRMADA]: confirmadaState,
  [MonetaryDonationStatus.RECHAZADA]: rechazadaState,
};

/** El objeto de estado que gobierna las transiciones de esta donación. */
export function stateFor(
  status: MonetaryDonationStatus,
): MonetaryDonationState {
  return STATES[status];
}

export type { MonetaryDonationState } from './monetary-donation-state';
