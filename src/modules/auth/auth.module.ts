import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from './entities/user.entity';
import { VerificationMailService } from './mail/verification-mail.service';
import { USER_REPOSITORY } from './repositories/user-repository.interface';
import { TypeOrmUserRepository } from './repositories/typeorm-user.repository';

@Module({
  imports: [
    PassportModule,
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: Number(config.get('JWT_EXPIRES_IN_SECONDS', '3600')),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    VerificationMailService,
    JwtStrategy,
    JwtAuthGuard,
    { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
