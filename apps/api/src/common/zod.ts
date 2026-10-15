import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';

/** Validates a request body against a zod schema: `@Body(new ZodPipe(schema)) body`. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const first = result.error.issues[0];
      const where = first.path.length ? `${first.path.join('.')}: ` : '';
      throw new BadRequestException(`${where}${first.message}`);
    }
    return result.data;
  }
}

/** Lowercase short id from a name: "Living room bulb" -> "living_room_bulb". */
export function slugKey(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'device';
}
