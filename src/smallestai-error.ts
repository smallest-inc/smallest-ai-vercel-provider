import { z } from 'zod';
import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';

export const smallestaiErrorDataSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
});

export type SmallestAIErrorData = z.infer<typeof smallestaiErrorDataSchema>;

export const smallestaiFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: smallestaiErrorDataSchema,
  errorToMessage: (data) => data.message ?? data.error ?? 'Unknown error',
});
