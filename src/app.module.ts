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
      // El endpoint `-pooler` de Neon es PgBouncer en modo transacción: varias
      // sesiones de cliente se multiplexan sobre la misma conexión de servidor.
      // `TenantContextInterceptor` establece el tenant con `SET ROLE` y
      // `set_config(..., false)`, que son estado de SESIÓN, así que a través
      // del pooler el contexto de una organización termina aplicándose a las
      // requests de otra y RLS filtra por el tenant equivocado (medido: 15 de
      // 15 cruces por el pooler, 0 de 15 por el endpoint directo). Se paga
      // perder el pooling; el upgrade, si el límite de conexiones de Neon
      // llegara a apretar, es que el interceptor use `SET LOCAL` dentro de una
      // transacción —seguro en modo transacción—, lo que obliga a sacar la
      // subida a Cloudinary de la sección crítica (ver tenant.interceptor.ts).
      // En local y en test la variable no existe y cae al fallback.
      url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
      schema: 'public',
      autoLoadEntities: true,
      synchronize: false,
      migrations: [__dirname + '/database/migrations/public/*{.ts,.js}'],
      migrationsTableName: 'migrations',
      // En serverless cada cold start correria las migraciones, y dos lambdas
      // podrian correrlas a la vez. En Vercel se corren a mano:
      // DATABASE_URL=... npm run migration:run
      migrationsRun: !process.env.VERCEL,
      // Fluid Compute corre varias invocaciones en el mismo proceso y
      // TenantContextInterceptor retiene una conexión por request: con max:1
      // la segunda request de la instancia esperaba una conexión que nadie
      // iba a devolver.
      extra: {
        max: process.env.VERCEL ? 5 : 10,
        // Un pool agotado tiene que fallar rápido: sin esto la request queda
        // colgada hasta el timeout de 300s de Vercel, quemando cómputo y
        // dejando la instancia envenenada para todas las siguientes. 10s y no
        // menos porque este mismo timeout cubre el establecimiento de la
        // conexión, y Neon suspende el compute por inactividad: la primera
        // request después de un rato de ocio tiene que poder esperar a que
        // despierte en vez de morir en un 500. Sigue fallando 30 veces más
        // rápido que el techo de la plataforma.
        connectionTimeoutMillis: 10_000,
      },
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
