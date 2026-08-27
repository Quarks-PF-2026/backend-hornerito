import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  NotImplementedException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { CloudinaryService } from '../../media/cloudinary.service';
import { UploadedFile } from '../../media/media.service';
import { User } from '../../auth/entities/user.entity';
import {
  OrganizationMembership,
  OrganizationMembershipRole,
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
import { CreateMonetaryDonationDto } from './dto/create-monetary-donation.dto';
import { MonetaryDonationService } from './monetary-donation.service';

/** PNG mínimo válido: los primeros 8 bytes son la firma que mira `detectImageMime`. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

function fileWith(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    buffer: PNG,
    size: PNG.length,
    mimetype: 'image/png',
    originalname: 'comprobante.png',
    ...overrides,
  } as UploadedFile;
}

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Comedor El Hornero',
    status: OrganizationStatus.VALIDATED,
    paymentAlias: 'comedor.hornero',
    paymentHolder: 'Asociación Hornero',
    ...overrides,
  } as Organization;
}

function dtoWith(
  overrides: Partial<CreateMonetaryDonationDto> = {},
): CreateMonetaryDonationDto {
  return {
    amount: 5000,
    method: DonationMethod.TRANSFERENCIA,
    ...overrides,
  };
}

function makeDonation(
  overrides: Partial<MonetaryDonation> = {},
): MonetaryDonation {
  return {
    id: 'donation-1',
    organizationId: 'org-1',
    amount: 5000,
    status: MonetaryDonationStatus.DECLARADA,
    method: DonationMethod.TRANSFERENCIA,
    operationNumber: null,
    receiptUrl: null,
    receiptPublicId: null,
    externalPaymentId: null,
    donorName: null,
    donorContact: null,
    decidedByUserId: null,
    decidedAt: null,
    rejectReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MonetaryDonationService', () => {
  let service: MonetaryDonationService;
  let donationRepo: { create: jest.Mock; save: jest.Mock };
  let tenantRepo: { findOneBy: jest.Mock; find: jest.Mock; save: jest.Mock };
  let organizationRepo: { findOneBy: jest.Mock };
  let membershipRepo: { find: jest.Mock };
  let userRepo: { find: jest.Mock };
  let cloudinary: { upload: jest.Mock };
  let mail: { send: jest.Mock };

  beforeEach(() => {
    donationRepo = {
      create: jest.fn(
        (data: Partial<MonetaryDonation>) =>
          ({
            ...data,
            id: 'donation-1',
            createdAt: new Date(),
          }) as MonetaryDonation,
      ),
      save: jest.fn((entity: MonetaryDonation) => Promise.resolve(entity)),
    };
    tenantRepo = {
      findOneBy: jest.fn().mockResolvedValue(makeDonation()),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((entity: MonetaryDonation) => Promise.resolve(entity)),
    };
    organizationRepo = {
      findOneBy: jest.fn().mockResolvedValue(makeOrganization()),
    };
    membershipRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    cloudinary = {
      upload: jest.fn().mockResolvedValue({
        url: 'https://cdn/comprobante.png',
        publicId: 'hornerito/test/org-1/donations/abc',
      }),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };

    const tenantContext = {
      organizationId: 'org-1',
      getManager: jest.fn().mockReturnValue({
        getRepository: () => tenantRepo,
      }),
    } as unknown as jest.Mocked<TenantContextService>;

    service = new MonetaryDonationService(
      donationRepo as unknown as Repository<MonetaryDonation>,
      organizationRepo as unknown as Repository<Organization>,
      membershipRepo as unknown as Repository<OrganizationMembership>,
      userRepo as unknown as Repository<User>,
      tenantContext,
      cloudinary as unknown as CloudinaryService,
      mail as unknown as MailService,
      {
        get: jest.fn().mockReturnValue('https://hornerito.test'),
      } as unknown as ConfigService,
    );
  });

  describe('declare', () => {
    it('registra la donación como declarada', async () => {
      const result = await service.declare(
        'org-1',
        dtoWith({ donorName: '  Ana  ', donorContact: '  Ana@Mail.COM ' }),
      );

      expect(result.status).toBe(MonetaryDonationStatus.DECLARADA);
      expect(donationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          amount: 5000,
          status: MonetaryDonationStatus.DECLARADA,
          donorName: 'Ana',
          // El email se normaliza a minúsculas, igual que en el resto del repo.
          donorContact: 'ana@mail.com',
        }),
      );
    });

    it('permite donar de forma anónima', async () => {
      await service.declare('org-1', dtoWith());

      expect(donationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ donorName: null, donorContact: null }),
      );
      // Sin email no hay a quién acusar recibo.
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('le acusa recibo al donante que dejó email', async () => {
      await service.declare('org-1', dtoWith({ donorContact: 'ana@mail.com' }));

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ana@mail.com' }),
      );
    });

    it('avisa a owner y admin, no a coordinadores ni voluntarios', async () => {
      membershipRepo.find.mockResolvedValue([
        { userId: 'user-1', role: OrganizationMembershipRole.OWNER },
      ]);
      userRepo.find.mockResolvedValue([
        { id: 'user-1', email: 'duenio@mail.com' },
      ]);

      await service.declare('org-1', dtoWith());

      expect(membershipRepo.find).toHaveBeenCalledWith({
        where: expect.arrayContaining([
          expect.objectContaining({
            role: OrganizationMembershipRole.OWNER,
            active: true,
          }) as unknown,
          expect.objectContaining({
            role: OrganizationMembershipRole.ADMIN,
            active: true,
          }) as unknown,
        ]) as unknown,
      });
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'duenio@mail.com' }),
      );
    });

    it('un fallo de SMTP no tumba la donación ya persistida', async () => {
      mail.send.mockRejectedValue(new Error('SMTP caído'));

      await expect(
        service.declare('org-1', dtoWith({ donorContact: 'ana@mail.com' })),
      ).resolves.toMatchObject({ status: MonetaryDonationStatus.DECLARADA });
    });

    it('rechaza Mercado Pago con 501 sin tocar la base', async () => {
      await expect(
        service.declare(
          'org-1',
          dtoWith({ method: DonationMethod.MERCADOPAGO }),
        ),
      ).rejects.toThrow(NotImplementedException);
      expect(organizationRepo.findOneBy).not.toHaveBeenCalled();
      expect(donationRepo.save).not.toHaveBeenCalled();
    });

    it('no distingue una organización inexistente de una no validada', async () => {
      organizationRepo.findOneBy.mockResolvedValue(
        makeOrganization({ status: OrganizationStatus.PENDING }),
      );

      await expect(service.declare('org-1', dtoWith())).rejects.toThrow(
        new NotFoundException('La organización no existe.'),
      );
    });

    it('bloquea a la organización que no cargó datos bancarios', async () => {
      organizationRepo.findOneBy.mockResolvedValue(
        makeOrganization({ paymentAlias: null }),
      );

      await expect(service.declare('org-1', dtoWith())).rejects.toThrow(
        ConflictException,
      );
    });

    it('sube el comprobante y guarda su URL', async () => {
      await service.declare('org-1', dtoWith(), fileWith());

      expect(cloudinary.upload).toHaveBeenCalledWith(
        PNG,
        expect.objectContaining({
          // `limit` y no `fill`: un comprobante recortado no se lee.
          transformation: expect.objectContaining({ crop: 'limit' }) as unknown,
        }),
      );
      expect(donationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ receiptUrl: 'https://cdn/comprobante.png' }),
      );
    });

    it('rechaza un comprobante que no es imagen, aunque mienta el mimetype', async () => {
      await expect(
        service.declare(
          'org-1',
          dtoWith(),
          fileWith({ buffer: Buffer.from('esto es un pdf disfrazado') }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(donationRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza un comprobante que supera el tope de tamaño', async () => {
      await expect(
        service.declare('org-1', dtoWith(), fileWith({ size: 9_000_000 })),
      ).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('confirm / reject', () => {
    it('confirma dejando la traza de quién decidió', async () => {
      const result = await service.confirm('donation-1', 'user-1');

      expect(result.status).toBe(MonetaryDonationStatus.CONFIRMADA);
      expect(tenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ decidedByUserId: 'user-1' }),
      );
    });

    it('rechaza guardando el motivo, recortado', async () => {
      const result = await service.reject(
        'donation-1',
        'user-1',
        '  sin registro  ',
      );

      expect(result.status).toBe(MonetaryDonationStatus.RECHAZADA);
      expect(result.rejectReason).toBe('sin registro');
    });

    it('avisa al donante cuando dejó email', async () => {
      tenantRepo.findOneBy.mockResolvedValue(
        makeDonation({ donorContact: 'ana@mail.com' }),
      );

      await service.confirm('donation-1', 'user-1');

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ana@mail.com' }),
      );
    });

    it('no deja confirmar dos veces', async () => {
      tenantRepo.findOneBy.mockResolvedValue(
        makeDonation({ status: MonetaryDonationStatus.CONFIRMADA }),
      );

      await expect(service.confirm('donation-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(tenantRepo.save).not.toHaveBeenCalled();
    });

    it('no encuentra donaciones de otra organización', async () => {
      tenantRepo.findOneBy.mockResolvedValue(null);

      await expect(service.confirm('donation-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('siempre filtra por organización, sin apoyarse solo en RLS', async () => {
      await service.confirm('donation-1', 'user-1');

      expect(tenantRepo.findOneBy).toHaveBeenCalledWith({
        id: 'donation-1',
        organizationId: 'org-1',
      });
    });
  });

  describe('list', () => {
    /** El `where` con el que se consultó, para mirarlo campo por campo. */
    function lastWhere(): Record<string, unknown> {
      const [args] = tenantRepo.find.mock.calls.at(-1) as [
        { where: Record<string, unknown> },
      ];
      return args.where;
    }

    it('filtra por estado cuando se pide', async () => {
      await service.list({ status: MonetaryDonationStatus.DECLARADA });

      expect(lastWhere()).toMatchObject({
        organizationId: 'org-1',
        status: MonetaryDonationStatus.DECLARADA,
      });
    });

    it('sin filtro devuelve todo el historial de la organización', async () => {
      await service.list();

      const where = lastWhere();
      expect(where.organizationId).toBe('org-1');
      expect(where.status).toBeUndefined();
      // Sin rango no se agrega condición sobre la fecha.
      expect(where.createdAt).toBeUndefined();
    });

    it('acota por rango de fechas', async () => {
      await service.list({ from: '2026-08-01', to: '2026-08-31' });

      expect(lastWhere().createdAt).toBeDefined();
    });

    it('combina estado y rango en la misma consulta', async () => {
      await service.list({
        status: MonetaryDonationStatus.CONFIRMADA,
        from: '2026-08-01',
      });

      const where = lastWhere();
      expect(where.status).toBe(MonetaryDonationStatus.CONFIRMADA);
      expect(where.createdAt).toBeDefined();
    });

    it('rechaza un rango dado vuelta', async () => {
      await expect(
        service.list({ from: '2026-08-31', to: '2026-08-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ordena de la más nueva a la más vieja', async () => {
      await service.list();

      const [args] = tenantRepo.find.mock.calls.at(-1) as [
        { order: Record<string, string> },
      ];
      expect(args.order).toEqual({ createdAt: 'DESC' });
    });
  });
});
