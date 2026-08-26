import { Module } from '@nestjs/common';
import * as pgDriver from 'pg';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { CollectionPointModule } from './modules/collection-point/collection-point.module';
import { DonationModule } from './modules/donation/donation.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { MailModule } from './modules/mail/mail.module';
import { MediaModule } from './modules/media/media.module';
import { NeedModule } from './modules/need/need.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PostModule } from './modules/post/post.module';
import { PublicModule } from './modules/public/public.module';
import { SupplyModule } from './modules/supply/supply.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { VolunteerTypeModule } from './modules/volunteer-type/volunteer-type.module';
import { VolunteeringModule } from './modules/volunteering/volunteering.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      // TypeORM carga 'pg' con un require dinamico que el tracer de Vercel no
      // ve, y la lambda sale sin el paquete. Pasarlo explicito lo hace estatico.
      driver: pgDriver,
      url: process.env.DATABASE_URL,
      schema: 'public',
      autoLoadEntities: true,
      synchronize: false,
      migrations: [__dirname + '/database/migrations/public/*{.ts,.js}'],
      migrationsTableName: 'migrations',
      // En serverless cada cold start correria las migraciones, y dos lambdas
      // podrian correrlas a la vez. En Vercel se corren a mano:
      // DATABASE_URL=... npm run migration:run
      migrationsRun: !process.env.VERCEL,
      // Una conexion por lambda: el pooler de Neon multiplexa del otro lado.
      extra: process.env.VERCEL ? { max: 1 } : undefined,
    }),
    MailModule,
    TenantModule,
    AuthModule,
    OrganizationModule,
    SupplyModule,
    NeedModule,
    PostModule,
    CollectionPointModule,
    DonationModule,
    VolunteerTypeModule,
    VolunteeringModule,
    GeocodingModule,
    MediaModule,
    PublicModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
