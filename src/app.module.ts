import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { NeedModule } from './modules/need/need.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { SupplyModule } from './modules/supply/supply.module';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      schema: 'public',
      autoLoadEntities: true,
      synchronize: false,
      migrations: [__dirname + '/database/migrations/public/*{.ts,.js}'],
      migrationsTableName: 'migrations',
      migrationsRun: true,
    }),
    TenantModule,
    AuthModule,
    OrganizationModule,
    SupplyModule,
    NeedModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
