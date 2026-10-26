import { z } from 'zod';
import { temperatureUnitSchema } from '@growspace/shared';

export const registerRequestSchema = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .min(3, 'Email must be at least 3 characters.')
    .max(254, 'Email must be 254 characters or fewer.')
    .email('Please provide a valid email address.'),
  password: z
    .string({ error: 'Password is required.' })
    .min(12, 'Password must be at least 12 characters long.')
    .max(128, 'Password must be 128 characters or fewer.'),
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name cannot be empty.')
    .max(80, 'Display name must be 80 characters or fewer.')
    .nullable()
    .optional(),
  temperatureUnit: temperatureUnitSchema.optional(),
});

export const loginRequestSchema = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .min(1, 'Email is required.')
    .max(254, 'Email must be 254 characters or fewer.'),
  password: z
    .string({ error: 'Password is required.' })
    .min(1, 'Password is required.')
    .max(128, 'Password must be 128 characters or fewer.'),
});

export const verifyEmailRequestSchema = z.object({
  token: z
    .string({ error: 'Verification token is required.' })
    .trim()
    .min(1, 'Verification token is required.')
    .max(128, 'Malformed verification token.'),
});

export const resendVerificationRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please provide a valid email address.')
    .optional(),
});

export const forgotPasswordRequestSchema = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .min(1, 'Email is required.')
    .max(254, 'Email must be 254 characters or fewer.')
    .email('Please provide a valid email address.'),
});

export const resetPasswordRequestSchema = z.object({
  token: z
    .string({ error: 'Reset token is required.' })
    .trim()
    .min(1, 'Reset token is required.')
    .max(128, 'Malformed reset token.'),
  password: z
    .string({ error: 'Password is required.' })
    .min(12, 'Password must be at least 12 characters long.')
    .max(128, 'Password must be 128 characters or fewer.'),
});

export type RegisterRequestBody = z.infer<typeof registerRequestSchema>;
export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
export type VerifyEmailRequestBody = z.infer<typeof verifyEmailRequestSchema>;
export type ResendVerificationRequestBody = z.infer<typeof resendVerificationRequestSchema>;
export type ForgotPasswordRequestBody = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequestBody = z.infer<typeof resetPasswordRequestSchema>;
