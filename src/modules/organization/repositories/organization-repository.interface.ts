import {
  Organization,
  OrganizationStatus,
} from '../entities/organization.entity';

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');

export interface IOrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findByIds(ids: string[]): Promise<Organization[]>;
  /** Cola de postulaciones a revisar (QK-19): pendientes, más antigua primero. */
  findPending(): Promise<Organization[]>;
  /**
   * Transición `pending` -> `status` como UPDATE condicional (QK-19): evita
   * el read-then-write de dos platform admins decidiendo la misma
   * organización a la vez. Devuelve si afectó una fila.
   */
  transitionFromPending(
    id: string,
    status: OrganizationStatus,
    rejectReason: string | null,
  ): Promise<boolean>;
  save(organization: Organization): Promise<Organization>;
  deleteById(id: string): Promise<void>;
}
