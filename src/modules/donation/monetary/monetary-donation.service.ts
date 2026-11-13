import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  PayloadTooLargeException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MailMessage, MailService } from '../../mail/mail.service';
import {
  monetaryDonationDecidedMail,
  monetaryDonationNoticeMail,
  monetaryDonationReceivedMail,
} from '../../mail/templates';
import { CloudinaryService } from '../../media/cloudinary.service';
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  detectImageMime,
} from '../../media/media-purposes';
import { UploadedFile } from '../../media/media.service';
import { AccountType, User } from '../../auth/entities/user.entity';
import {
  MEMBER_MANAGER_ROLES,
  OrganizationMembership,
} from '../../organization/entities/organization-membership.entity';
import {
  Organization,
  OrganizationStatus,
} from '../../organization/entities/organization.entity';
import { TenantContextService } from '../../tenant/tenant-context.service';
import {
  DonationMethod,
  MonetaryDonation,
  MonetaryDonationStatus,
} from '../entities/monetary-donation.entity';
import { createdAtWithin } from '../date-range';
import { CreateMonetaryDonationDto } from './dto/create-monetary-donation.dto';
import { ListMonetaryDonationsDto } from './dto/list-monetary-donations.dto';
import { stateFor } from './states';

export interface MonetaryDonationView {
  id: string;
  amount: number;
  status: MonetaryDonationStatus;
  method: DonationMethod;
  operationNumber: string | null;
  receiptUrl: string | null;
  donorName: string | null;
  donorContact: string | null;
  /**
   * Id para enlazar el perfil público del donante (QK-110), solo cuando esta
   * misma donación ya garantiza que el perfil existe (DOMAIN §17). En otro caso
   * `null`: nunca para una anónima, aunque el panel vea su nombre (§7).
   */
  donorProfileId: string | null;
  rejectReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/**
 * Donación económica (QK-20).
 *
 * Conviven dos vías de acceso a datos a propósito, igual que en
 * `VolunteerRequestService`:
 *
 * - `declare` la llama un visitante desde la ficha pública —con o sin sesión,
 *   pero nunca dentro de una organización—, así que no hay tenant que setear: usa los repositorios inyectados, que van por la conexión owner. El
 *   recorte lo hace este service resolviendo la organización `validated` de la
 *   URL antes de escribir.
 * - el panel (`list`, `confirm`, `reject`) entra autenticado, con `TenantGuard`
 *   ya corrido, así que usa `TenantContextService` y viaja con RLS activo.
 *
 * `TenantContextService` es `Scope.REQUEST` pero solo falla al invocar
 * `organizationId`/`getManager()`, que la vía anónima nunca toca.
 */
@Injectable()
export class MonetaryDonationService {
  private readonly logger = new Logger(MonetaryDonationService.name);

  constructor(
    @InjectRepository(MonetaryDonation)
    private readonly donations: Repository<MonetaryDonation>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationMembership)
    private readonly memberships: Repository<OrganizationMembership>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tenantContext: TenantContextService,
    private readonly cloudinary: CloudinaryService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Vía pública: alguien declara que transfirió desde la ficha. Con sesión
   * (`donorUserId`) la donación queda asociada a la cuenta (QK-113); nombre y
   * contacto siguen siendo los que vinieron en el formulario —el front los
   * precarga de la cuenta y el donante puede cambiarlos solo para esta
   * donación—, así que el perfil no se toca.
   */
  async declare(
    organizationId: string,
    dto: CreateMonetaryDonationDto,
    file?: UploadedFile,
    donorUserId?: string,
  ): Promise<{ id: string; status: MonetaryDonationStatus }> {
    // Mercado Pago está contemplado en el modelo (enum, `externalPaymentId`) y
    // en la UI, pero todavía no implementado. Cuando entre, acá va la creación
    // de la preference y la donación nace en un estado pendiente de pago; el
    // webhook llama a `confirm` en lugar del owner/admin.
    if (dto.method === DonationMethod.MERCADOPAGO) {
      throw new NotImplementedException(
        'El pago con Mercado Pago todavía no está disponible. Doná por transferencia.',
      );
    }

    const organization = await this.organizations.findOneBy({
      id: organizationId,
    });
    // Mismo mensaje que PublicService: desde afuera no se distingue una
    // organización inexistente de una que todavía no fue validada.
    if (!organization || organization.status !== OrganizationStatus.VALIDATED) {
      throw new NotFoundException('La organización no existe.');
    }
    if (!organization.paymentAlias) {
      throw new ConflictException(
        'La organización todavía no recibe donaciones económicas.',
      );
    }

    // Una cuenta de organización que dona lo hace en nombre de su organización,
    // no como persona: se registra como si no hubiera sesión, así nunca entra
    // en el ranking ni en el perfil de donante.
    const donorAccount = donorUserId
      ? await this.users.findOneBy({ id: donorUserId })
      : null;
    const sessionUserId =
      donorAccount?.accountType === AccountType.ORGANIZATION
        ? undefined
        : donorUserId;

    const receipt = file
      ? await this.uploadReceipt(organizationId, file)
      : null;

    const donation = await this.donations.save(
      this.donations.create({
        organizationId,
        amount: dto.amount,
        status: MonetaryDonationStatus.DECLARADA,
        method: dto.method,
        operationNumber: dto.operationNumber?.trim() || null,
        donorName: dto.donorName?.trim() || null,
        donorContact: dto.donorContact?.trim().toLowerCase() || null,
        donorUserId: sessionUserId ?? null,
        // Sin cuenta no hay superficie pública de la que esconderse: el flag
        // solo se guarda con sesión, para no dejar filas "anónimas" sin dueño.
        isAnonymous: sessionUserId ? (dto.isAnonymous ?? false) : false,
        receiptUrl: receipt?.url ?? null,
        receiptPublicId: receipt?.publicId ?? null,
        externalPaymentId: null,
        decidedByUserId: null,
        decidedAt: null,
        rejectReason: null,
      }),
    );

    await this.notifyDeclared(organization, donation);

    return { id: donation.id, status: donation.status };
  }

  /** Vía panel: el historial lo ve cualquier miembro activo. */
  async list(
    query: ListMonetaryDonationsDto = {},
  ): Promise<MonetaryDonationView[]> {
    // La clave se omite cuando no hay rango: TypeORM rechaza un `undefined`
    // dentro del `where` en vez de ignorarlo.
    const createdAt = createdAtWithin(query);
    const rows = await this.repo().find({
      where: {
        organizationId: this.orgId,
        ...(query.status ? { status: query.status } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      order: { createdAt: 'DESC' },
    });
    const profiles = await this.donorProfiles(rows);
    return rows.map((row) => toView(row, profiles));
  }

  async confirm(id: string, userId: string): Promise<MonetaryDonationView> {
    return this.decide(id, (donation) =>
      stateFor(donation.status).confirm(donation, userId),
    );
  }

  async reject(
    id: string,
    userId: string,
    reason: string,
  ): Promise<MonetaryDonationView> {
    return this.decide(id, (donation) =>
      stateFor(donation.status).reject(donation, userId, reason.trim()),
    );
  }

  /**
   * Carga la donación del tenant, deja que su estado decida si la transición es
   * legal, persiste y avisa. El `if` de qué se puede hacer vive en el estado.
   */
  private async decide(
    id: string,
    transition: (donation: MonetaryDonation) => void,
  ): Promise<MonetaryDonationView> {
    const repo = this.repo();
    const donation = await repo.findOneBy({ id, organizationId: this.orgId });
    if (!donation) {
      throw new NotFoundException('La donación no existe.');
    }

    transition(donation);
    const saved = await repo.save(donation);

    await this.notifyDecided(saved);

    // Confirmar es justo lo que vuelve enlazable al donante: el front reemplaza
    // la fila con esta respuesta, así que tiene que traer el id ya resuelto.
    return toView(saved, await this.donorProfiles([saved]));
  }

  private async uploadReceipt(
    organizationId: string,
    file: UploadedFile,
  ): Promise<{ url: string; publicId: string }> {
    if (!file.buffer?.length) {
      throw new BadRequestException('No llegó ningún archivo.');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `El comprobante supera el máximo de ${Math.round(MAX_UPLOAD_BYTES / 1_000_000)} MB.`,
      );
    }
    // El `mimetype` lo manda el cliente y es falsificable, así que se mira el
    // contenido real, igual que en `MediaService`.
    if (!detectImageMime(file.buffer)) {
      throw new BadRequestException(
        `El comprobante tiene que ser una imagen ${ALLOWED_MIME_TYPES.join(', ')}.`,
      );
    }

    const env = process.env.NODE_ENV ?? 'development';
    return this.cloudinary.upload(file.buffer, {
      folder: `hornerito/${env}/${organizationId}/donations`,
      // `limit` y no `fill`: un comprobante recortado deja de ser legible.
      transformation: { width: 1600, height: 1600, crop: 'limit' },
    });
  }

  /**
   * Acuse al donante —si dejó email— y aviso a quienes pueden confirmar. Los
   * mails son best-effort: una falla de SMTP no puede convertir una donación ya
   * persistida en un 500.
   */
  private async notifyDeclared(
    organization: Organization,
    donation: MonetaryDonation,
  ): Promise<void> {
    const url = `${this.config.get<string>('APP_BASE_URL') ?? ''}/app/donaciones/economicas`;

    if (donation.donorContact) {
      await this.trySend(
        monetaryDonationReceivedMail(
          donation.donorContact,
          organization.name,
          donation.amount,
          donation.operationNumber,
        ),
      );
    }

    for (const email of await this.managerEmails(organization.id)) {
      await this.trySend(
        monetaryDonationNoticeMail(
          email,
          organization.name,
          donation.amount,
          donation.donorName,
          donation.operationNumber,
          url,
        ),
      );
    }
  }

  /**
   * Solo la llaman `confirm` y `reject`, que entran con `TenantGuard`: acá el
   * interceptor ya tiene un runner tomado para toda la request, así que pedir
   * el nombre de la organización por `this.organizations` sería pedirle al pool
   * una segunda conexión que la propia request no puede liberar. Con el pool
   * chico de serverless eso es un deadlock, no una espera.
   */
  private async notifyDecided(donation: MonetaryDonation): Promise<void> {
    if (!donation.donorContact) {
      return;
    }
    const organization = await this.tenantContext
      .getManager()
      .getRepository(Organization)
      .findOneBy({ id: donation.organizationId });
    await this.trySend(
      monetaryDonationDecidedMail(
        donation.donorContact,
        organization?.name ?? 'la organización',
        donation.amount,
        donation.status === MonetaryDonationStatus.CONFIRMADA,
        donation.rejectReason,
      ),
    );
  }

  /** Emails de los miembros activos que pueden confirmar la recepción. */
  private async managerEmails(organizationId: string): Promise<string[]> {
    const memberships = await this.memberships.find({
      where: MEMBER_MANAGER_ROLES.map((role) => ({
        organizationId,
        role,
        active: true,
      })),
    });
    if (memberships.length === 0) {
      return [];
    }
    const users = await this.users.find({
      where: memberships.map((membership) => ({ id: membership.userId })),
    });
    return users.map((user) => user.email);
  }

  private async trySend(message: MailMessage): Promise<void> {
    try {
      await this.mail.send(message);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el mail de donación a ${message.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Donaciones que garantizan el perfil público de su donante: las
   * mismas reglas que `PublicService.countedDonations()` aplicadas a la fila
   * (la organización ya está `validated`, si no el panel no opera). El tipo de
   * cuenta se relee porque una donación previa a la separación de tipos puede
   * traer el id de una cuenta que la migración pasó a `organization`, y esa no
   * tiene perfil (§3, §17). Va por el repo owner: `users` no es del tenant.
   */
  private async donorProfiles(
    donations: MonetaryDonation[],
  ): Promise<Set<string>> {
    const eligible = donations.filter(
      (d) =>
        d.status === MonetaryDonationStatus.CONFIRMADA &&
        !d.isAnonymous &&
        d.donorUserId,
    );
    if (!eligible.length) return new Set();
    const donors = await this.users.find({
      where: {
        id: In([...new Set(eligible.map((d) => d.donorUserId))]),
        accountType: AccountType.DONOR,
      },
      select: { id: true },
    });
    const donorIds = new Set(donors.map((u) => u.id));
    // Por donación, no por cuenta: otra fila del mismo donante (pendiente,
    // anónima) no hereda el enlace.
    return new Set(
      eligible.filter((d) => donorIds.has(d.donorUserId!)).map((d) => d.id),
    );
  }

  private get orgId(): string {
    return this.tenantContext.organizationId;
  }

  private repo(): Repository<MonetaryDonation> {
    return this.tenantContext.getManager().getRepository(MonetaryDonation);
  }
}

function toView(
  donation: MonetaryDonation,
  donorProfiles: Set<string>,
): MonetaryDonationView {
  return {
    id: donation.id,
    amount: donation.amount,
    status: donation.status,
    method: donation.method,
    operationNumber: donation.operationNumber,
    receiptUrl: donation.receiptUrl,
    donorName: donation.donorName,
    donorContact: donation.donorContact,
    donorProfileId: donorProfiles.has(donation.id)
      ? donation.donorUserId
      : null,
    rejectReason: donation.rejectReason,
    decidedAt: donation.decidedAt,
    createdAt: donation.createdAt,
  };
}
