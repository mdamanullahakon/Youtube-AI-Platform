import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../../../validators/auth.validator';

describe('Auth Validators', () => {
  describe('registerSchema', () => {
    it('should accept valid input', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'StrongPass1!',
        name: 'Test User',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing email', () => {
      const result = registerSchema.safeParse({ password: 'StrongPass1!', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = registerSchema.safeParse({ email: 'not-an-email', password: 'StrongPass1!' });
      expect(result.success).toBe(false);
    });

    it('should reject short password (< 8 chars)', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'Short1!' });
      expect(result.success).toBe(false);
    });

    it('should reject password without uppercase', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'lowercase1!' });
      expect(result.success).toBe(false);
    });

    it('should reject password without lowercase', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'UPPERCASE1!' });
      expect(result.success).toBe(false);
    });

    it('should reject password without digit', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'Uppercase!' });
      expect(result.success).toBe(false);
    });

    it('should reject password without special char', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'Uppercase1' });
      expect(result.success).toBe(false);
    });

    it('should reject password exceeding max length', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'A1!' + 'x'.repeat(130) });
      expect(result.success).toBe(false);
    });

    it('should accept valid input without optional name', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'StrongPass1!',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('loginSchema', () => {
    it('should accept valid login input', () => {
      const result = loginSchema.safeParse({ email: 'test@example.com', password: 'any-password' });
      expect(result.success).toBe(true);
    });

    it('should reject missing email', () => {
      const result = loginSchema.safeParse({ password: 'any' });
      expect(result.success).toBe(false);
    });

    it('should reject missing password', () => {
      const result = loginSchema.safeParse({ email: 'test@example.com' });
      expect(result.success).toBe(false);
    });
  });

  describe('forgotPasswordSchema', () => {
    it('should accept valid email', () => {
      const result = forgotPasswordSchema.safeParse({ email: 'test@example.com' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = forgotPasswordSchema.safeParse({ email: 'bad' });
      expect(result.success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('should accept valid input', () => {
      const result = resetPasswordSchema.safeParse({ token: 'reset-token', password: 'StrongPass1!' });
      expect(result.success).toBe(true);
    });

    it('should reject weak password', () => {
      const result = resetPasswordSchema.safeParse({ token: 'reset-token', password: 'weak' });
      expect(result.success).toBe(false);
    });
  });
});
