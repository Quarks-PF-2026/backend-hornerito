import { ConflictException } from '@nestjs/common';
import { MonetaryDonationState } from './monetary-donation-state';

/**
 * Estados terminales: una vez que la organización se expidió, la donación no
 * se vuelve a tocar. Corregir una decisión equivocada es un caso de negocio
 * que todavía no existe; cuando exista, se agrega acá una transición explícita
 * en vez de dejar que cualquiera reescriba el estado.
 */
function terminal(label: string): MonetaryDonationState {
  const fail = (): never => {
    throw new ConflictException(`La donación ya fue ${label}.`);
  };
  return { confirm: fail, reject: fail };
}

export const confirmadaState = terminal('confirmada');
export const rechazadaState = terminal('rechazada');
