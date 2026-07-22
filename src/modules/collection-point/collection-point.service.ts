import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ILike, Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  CreateCollectionPointDto,
  ScheduleDayDto,
} from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';
import {
  CollectionPoint,
  ScheduleDay,
} from './entities/collection-point.entity';

@Injectable()
export class CollectionPointService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async list(): Promise<CollectionPoint[]> {
    const repo = await this.repo();
    return repo.find({ order: { createdAt: 'ASC' } });
  }

  async create(dto: CreateCollectionPointDto): Promise<CollectionPoint> {
    const repo = await this.repo();
    await this.assertNameAvailable(repo, dto.name);
    const schedule = this.normalizeSchedule(dto.schedule);
    return repo.save(repo.create({ ...dto, schedule, active: true }));
  }

  async update(
    id: string,
    dto: UpdateCollectionPointDto,
  ): Promise<CollectionPoint> {
    const point = await this.findOrFail(id);
    const repo = await this.repo();
    await this.assertNameAvailable(repo, dto.name, id);
    point.name = dto.name;
    point.addressLine = dto.addressLine;
    point.latitude = dto.latitude;
    point.longitude = dto.longitude;
    point.phone = dto.phone;
    point.email = dto.email ?? null;
    point.contactName = dto.contactName ?? null;
    point.schedule = this.normalizeSchedule(dto.schedule);
    return repo.save(point);
  }

  /**
   * Un punto inactivo deja de ofrecerse para donaciones nuevas, pero las
   * donaciones ya pendientes en ese punto siguen siendo válidas.
   */
  async deactivate(id: string): Promise<CollectionPoint> {
    return this.setActive(id, false);
  }

  async activate(id: string): Promise<CollectionPoint> {
    return this.setActive(id, true);
  }

  private async setActive(
    id: string,
    active: boolean,
  ): Promise<CollectionPoint> {
    const point = await this.findOrFail(id);
    point.active = active;
    const repo = await this.repo();
    return repo.save(point);
  }

  private async findOrFail(id: string): Promise<CollectionPoint> {
    const repo = await this.repo();
    const point = await repo.findOneBy({ id });
    if (!point) {
      throw new NotFoundException('El punto de recolección no existe.');
    }
    return point;
  }

  private async assertNameAvailable(
    repo: Repository<CollectionPoint>,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await repo.findOne({ where: { name: ILike(name) } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(
        'Ya existe un punto de recolección con ese nombre.',
      );
    }
  }

  private normalizeSchedule(schedule: ScheduleDayDto[]): ScheduleDay[] {
    const days = new Set(schedule.map((d) => d.day));
    if (days.size !== 7) {
      throw new BadRequestException(
        'El horario debe cubrir los 7 días de la semana.',
      );
    }

    const normalized = schedule.map((day) => {
      if (day.closed) {
        return { day: day.day, closed: true, open: null, close: null };
      }
      if (!day.open || !day.close || day.open >= day.close) {
        throw new BadRequestException(
          'La hora de cierre tiene que ser posterior a la de apertura.',
        );
      }
      return { day: day.day, closed: false, open: day.open, close: day.close };
    });

    if (normalized.every((day) => day.closed)) {
      throw new BadRequestException(
        'El punto tiene que abrir al menos un día.',
      );
    }

    return normalized.sort((a, b) => a.day - b.day);
  }

  private async repo(): Promise<Repository<CollectionPoint>> {
    const manager = await this.tenantContext.getManager();
    return manager.getRepository(CollectionPoint);
  }
}
