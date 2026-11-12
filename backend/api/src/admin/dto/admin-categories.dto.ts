import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Trims and collapses inner whitespace, so "  Lab   kits " and "Lab kits" are the same name. */
const cleanName = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

export class CategoryNameDto {
  @Transform(cleanName) @IsString() @MinLength(2) @MaxLength(60) name!: string;
}
