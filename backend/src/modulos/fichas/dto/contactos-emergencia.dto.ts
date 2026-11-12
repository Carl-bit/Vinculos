import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

import { Recortar, TELEFONO_CL } from '../../../core/validacion/validadores';

/** Punto 38: contacto de emergencia que agrega el paciente (o su adulto responsable). */
export class ContactoEmergenciaDto {
  /** Adulto responsable: el menor a cargo. El paciente adulto no lo indica. */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre!: string;

  @Recortar()
  @IsString()
  @Length(1, 60)
  parentesco!: string;

  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono!: string;
}

export class PacienteContactosDto {
  /** Adulto responsable: el menor a cargo. */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;
}

/** El tratante abre los datos solo en una emergencia: el motivo queda en accesos_ficha. */
export class EmergenciaContactoDto {
  @Recortar()
  @IsString()
  @Length(5, 200)
  motivo!: string;
}

export class ContactoEmergenciaVista {
  id!: string;
  nombre!: string;
  parentesco!: string;
  telefono!: string;
}

/** Lo que ve el tratante sin emergencia: que existe y el parentesco. */
export class ContactoEmergenciaResumen {
  id!: string;
  parentesco!: string;
}

/** Punto 9: atencion temporal abierta del paciente (la consulta el equipo al agendar). */
export class RetornoAtencionTemporal {
  profesionalPrincipalId!: string;
  principalDisponible!: boolean;
  pideVolver!: boolean;
  tratanteActualId!: string;
}
