import { ArrowLeft, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authErrorMessage, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/error-state';

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (resetError) {
      setError(authErrorMessage(resetError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 rounded-control text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to sign in
      </Link>

      <div className="mt-5 mb-6">
        <h1 className="text-2xl font-semibold text-forest">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your account email and we’ll send a reset link if the account exists.
        </p>
      </div>

      {error ? (
        <div className="mb-5">
          <ErrorState title="Could not send reset email" message={error} />
        </div>
      ) : null}

      {sent ? (
        <div className="rounded-card border border-success/20 bg-success-surface/60 p-5" role="status">
          <p className="font-semibold text-ink">Check your inbox</p>
          <p className="mt-1 text-sm text-muted">
            If an account exists for {email.trim()}, a password reset link is on its way. Also check
            your spam folder.
          </p>
          <Link to="/login" className="mt-4 inline-flex text-sm font-semibold text-sage hover:text-forest">
            Return to sign in
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <Button
            type="submit"
            className="w-full"
            loading={submitting}
            disabled={!email.trim()}
            icon={<Mail className="h-4 w-4" aria-hidden="true" />}
          >
            Send reset link
          </Button>
        </form>
      )}
    </Card>
  );
}
