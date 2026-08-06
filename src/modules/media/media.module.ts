import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicModule } from '../public/public.module';
import { CloudinaryService } from './cloudinary.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule, PublicModule],
  controllers: [MediaController],
  providers: [MediaService, CloudinaryService],
})
export class MediaModule {}
