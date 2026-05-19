import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type PaginationInput = z.infer<typeof paginationQuery>;

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  pagination: PaginationInput,
): PaginatedResponse<T> {
  const { page, limit } = pagination;
  return {
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
}

export function paginate(pagination: PaginationInput): { skip: number; take: number } {
  return {
    skip: (pagination.page - 1) * pagination.limit,
    take: pagination.limit,
  };
}

export const projectIdParams = z.object({
  projectId: z.string().cuid('Invalid project ID'),
});

export const accountIdParams = z.object({
  accountId: z.string().min(1, 'Account ID is required'),
});

export const queueNameParams = z.object({
  queueName: z.string().min(1, 'Queue name is required'),
});

export const queueJobParams = z.object({
  queueName: z.string().min(1, 'Queue name is required'),
  jobId: z.string().min(1, 'Job ID is required'),
});

export const idParam = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const jtiParam = z.object({
  jti: z.string().min(1, 'Session JTI is required'),
});

export const jobIdParam = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
});
