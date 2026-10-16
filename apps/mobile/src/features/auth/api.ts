import { LoginResponseSchema, MeResponseSchema, type LoginRequest } from '@media-library/contracts';
import { z } from 'zod';
import type { ApiClient } from '../../lib/api';

export const login = (client: ApiClient, credentials: LoginRequest) =>
  client.request({
    method: 'POST',
    path: '/v1/auth/login',
    body: credentials,
    schema: LoginResponseSchema,
  });

export const logout = (client: ApiClient) =>
  client.request({ method: 'POST', path: '/v1/auth/logout', schema: z.unknown() });

export const fetchMe = (client: ApiClient, signal?: AbortSignal) =>
  client.request({ path: '/v1/me', schema: MeResponseSchema, signal });
