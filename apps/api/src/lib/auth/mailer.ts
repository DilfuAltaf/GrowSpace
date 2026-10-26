export interface SentEmailRecord {
  to: string;
  subject: string;
  type: 'verification' | 'password_reset';
  link: string;
  sentAt: Date;
}

export interface AuthMailer {
  sendVerification(to: string, verificationLink: string): Promise<{ messageId?: string }>;
  sendPasswordReset(to: string, resetLink: string): Promise<{ messageId?: string }>;
}

/**
 * Resend API implementation for production transactional emails.
 * Uses native fetch over HTTPS with certificate validation and request timeout.
 */
export class ResendAuthMailer implements AuthMailer {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(options?: { apiKey?: string; from?: string }) {
    const key = options?.apiKey ?? process.env.EMAIL_PROVIDER_API_KEY ?? process.env.RESEND_API_KEY;
    const fromAddr = options?.from ?? process.env.EMAIL_FROM ?? 'GrowSpace <noreply@growspace.org>';

    if (!key || key.trim().length === 0) {
      throw new Error('EMAIL_PROVIDER_API_KEY is not configured for email delivery.');
    }

    this.apiKey = key.trim();
    this.from = fromAddr.trim();
  }

  async sendVerification(to: string, verificationLink: string): Promise<{ messageId?: string }> {
    const subject = 'Verify your email address — GrowSpace';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #166534;">Welcome to GrowSpace!</h2>
        <p>Please confirm your email address to activate all garden features.</p>
        <p style="margin: 24px 0;">
          <a href="${verificationLink}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Verify Email Address
          </a>
        </p>
        <p style="color: #64748b; font-size: 14px;">This link expires in 24 hours. If you did not sign up for GrowSpace, please ignore this email.</p>
      </div>
    `;

    return this.postEmail({ to, subject, html });
  }

  async sendPasswordReset(to: string, resetLink: string): Promise<{ messageId?: string }> {
    const subject = 'Reset your GrowSpace password';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #166534;">GrowSpace Password Reset</h2>
        <p>You requested a password reset for your GrowSpace account.</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Reset Password
          </a>
        </p>
        <p style="color: #64748b; font-size: 14px;">This link expires in 30 minutes. If you did not request a reset, you can safely ignore this email.</p>
      </div>
    `;

    return this.postEmail({ to, subject, html });
  }

  private async postEmail(payload: { to: string; subject: string; html: string }): Promise<{ messageId?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s request timeout

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errSnippet = `HTTP ${res.status}`;
        try {
          const errJson = await res.json() as { message?: string; name?: string };
          errSnippet = `${errSnippet}: ${errJson.message ?? errJson.name ?? 'Unknown provider error'}`;
        } catch {
          // Ignore JSON parse failure on error body
        }
        throw new Error(`Email provider error: ${errSnippet}`);
      }

      const data = await res.json() as { id?: string };
      return { messageId: data.id };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * In-memory Mock Mailer for testing and local development.
 * Never performs real network requests or leaks secrets.
 */
export class MockAuthMailer implements AuthMailer {
  readonly sentEmails: SentEmailRecord[] = [];
  private shouldFail = false;
  private failureError: Error | null = null;
  onBeforeSendVerification?: (to: string, link: string) => Promise<void> | void;
  onBeforeSendPasswordReset?: (to: string, link: string) => Promise<void> | void;

  setShouldFail(fail: boolean, error?: Error): void {
    this.shouldFail = fail;
    this.failureError = error ?? (fail ? new Error('Simulated mail provider network timeout') : null);
  }

  async sendVerification(to: string, verificationLink: string): Promise<{ messageId?: string }> {
    if (this.onBeforeSendVerification) {
      await this.onBeforeSendVerification(to, verificationLink);
    }

    if (this.shouldFail) {
      throw this.failureError ?? new Error('Simulated email delivery failure');
    }

    const messageId = `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.sentEmails.push({
      to,
      subject: 'Verify your email address — GrowSpace',
      type: 'verification',
      link: verificationLink,
      sentAt: new Date(),
    });

    return { messageId };
  }

  async sendPasswordReset(to: string, resetLink: string): Promise<{ messageId?: string }> {
    if (this.onBeforeSendPasswordReset) {
      await this.onBeforeSendPasswordReset(to, resetLink);
    }

    if (this.shouldFail) {
      throw this.failureError ?? new Error('Simulated email delivery failure');
    }

    const messageId = `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.sentEmails.push({
      to,
      subject: 'Reset your GrowSpace password',
      type: 'password_reset',
      link: resetLink,
      sentAt: new Date(),
    });

    return { messageId };
  }

  getLastEmail(): SentEmailRecord | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  clear(): void {
    this.sentEmails.length = 0;
    this.shouldFail = false;
    this.failureError = null;
    this.onBeforeSendVerification = undefined;
    this.onBeforeSendPasswordReset = undefined;
  }
}

let activeMailerOverride: AuthMailer | null = null;
const defaultMockMailer = new MockAuthMailer();

/**
 * Sets a custom or mock mailer for test isolation.
 */
export function setAuthMailerOverride(mailer: AuthMailer | null): void {
  activeMailerOverride = mailer;
}

/**
 * Resolves the configured AuthMailer instance.
 * Defaults to MockAuthMailer in test/dev when EMAIL_PROVIDER_API_KEY is not set.
 */
export function getAuthMailer(): AuthMailer {
  if (activeMailerOverride) {
    return activeMailerOverride;
  }

  const key = process.env.EMAIL_PROVIDER_API_KEY ?? process.env.RESEND_API_KEY;
  if (key && key.trim().length > 0) {
    return new ResendAuthMailer();
  }

  return defaultMockMailer;
}
