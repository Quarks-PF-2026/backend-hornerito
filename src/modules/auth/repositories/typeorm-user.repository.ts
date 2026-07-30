import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { IUserRepository } from './user-repository.interface';

@Injectable()
export class TypeOrmUserRepository implements IUserRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<User[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  findByVerificationToken(token: string): Promise<User | null> {
    return this.repo.findOneBy({ verificationToken: token });
  }

  create(user: Partial<User>): Promise<User> {
    return this.repo.save(this.repo.create(user));
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }
}
