// eslint-disable-next-line import-x/no-named-as-default
import z from 'zod';

export const featurePropertiesSchema = z
  .object(
    {
      id: z.string().or(z.number()).describe('Feature ID'),
    },
    { message: 'error(ShapeFileReader): Feature must have an id' }
  )
  .loose();
