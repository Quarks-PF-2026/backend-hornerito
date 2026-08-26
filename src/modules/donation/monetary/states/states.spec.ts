import { ConflictException } from '@nestjs/common';
import {
  MonetaryDonation,
  MonetaryDonationStatus,
} from '../../entities/monetary-donation.entity';
import { stateFor } from './index';

function donationIn(status: MonetaryDonationStatus): MonetaryDonation {
  return {
    status,
    decidedByUserId: null,
    decidedAt: null,
    rejectReason: null,
  } as MonetaryDonation;
}

describe('máquina de estados de la donación económica', () => {
  describe('declarada', () => {
    it('confirma y deja la traza de quién decidió', () => {
      const donation = donationIn(MonetaryDonationStatus.DECLARADA);

      stateFor(donation.status).confirm(donation, 'user-1');

      expect(donation.status).toBe(MonetaryDonationStatus.CONFIRMADA);
      expect(donation.decidedByUserId).toBe('user-1');
      expect(donation.decidedAt).toBeInstanceOf(Date);
      expect(donation.rejectReason).toBeNull();
    });

    it('rechaza guardando el motivo', () => {
      const donation = donationIn(MonetaryDonationStatus.DECLARADA);

      stateFor(donation.status).reject(
        donation,
        'user-1',
        'No figura en el extracto',
      );

      expect(donation.status).toBe(MonetaryDonationStatus.RECHAZADA);
      expect(donation.rejectReason).toBe('No figura en el extracto');
      expect(donation.decidedAt).toBeInstanceOf(Date);
    });
  });

  describe('estados terminales', () => {
    it.each([
      [MonetaryDonationStatus.CONFIRMADA, 'confirmada'],
      [MonetaryDonationStatus.RECHAZADA, 'rechazada'],
    ])('%s no se vuelve a confirmar', (status, label) => {
      const donation = donationIn(status);

      expect(() => stateFor(status).confirm(donation, 'user-1')).toThrow(
        ConflictException,
      );
      expect(() => stateFor(status).confirm(donation, 'user-1')).toThrow(
        `La donación ya fue ${label}.`,
      );
    });

    it.each([
      MonetaryDonationStatus.CONFIRMADA,
      MonetaryDonationStatus.RECHAZADA,
    ])('%s no se vuelve a rechazar', (status) => {
      const donation = donationIn(status);

      expect(() =>
        stateFor(status).reject(donation, 'user-1', 'motivo'),
      ).toThrow(ConflictException);
    });

    it('no muta la donación cuando la transición es ilegal', () => {
      const donation = donationIn(MonetaryDonationStatus.CONFIRMADA);

      expect(() =>
        stateFor(donation.status).reject(donation, 'user-2', 'me arrepentí'),
      ).toThrow(ConflictException);
      expect(donation.status).toBe(MonetaryDonationStatus.CONFIRMADA);
      expect(donation.rejectReason).toBeNull();
      expect(donation.decidedByUserId).toBeNull();
    });
  });
});
