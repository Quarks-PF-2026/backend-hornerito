import { User } from '../entities/user.entity';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

// Template del proyecto: cada dominio expone una interfaz de repositorio
// (IXxxRepository) desacoplada de TypeORM, con una implementación concreta
// inyectada vía el token de arriba.
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByVerificationToken(token: string): Promise<User | null>;
  create(user: Partial<User>): Promise<User>;
  save(user: User): Promise<User>;
}
