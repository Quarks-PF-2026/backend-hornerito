import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresá el nombre de la organización.' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Ingresá una descripción.' })
  description: string;

  @IsString()
  @IsNotEmpty({ message: 'Ingresá la dirección.' })
  address: string;

  @IsString()
  @IsNotEmpty({ message: 'Ingresá un contacto.' })
  contact: string;
}
