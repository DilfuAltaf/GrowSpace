import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';
import { authErrorMessage } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/error-state';

export function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    return firstPartyAuthClient.extractTokenFromFragment(hash, false);
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const tokenMissing = !token && !resetSuccess;

  useEffect(() => {
    // Scrub token from hash fragment in browser history for privacy
    if (typeof window !== 'undefined' && window.location.hash.includes('token=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    if (!token) {
      setError('Missing or invalid reset token. Please request a new reset link.');
      return;
    }

    // Backend contract enforces min 12 characters and max 128 characters
    if (password.length < 12) {
      setFieldError('Use at least 12 characters for your new password.');
      return;
    }
    if (password.length > 128) {
      setFieldError('Password must be 128 characters or fewer.');
      return;
    }
    if (password !== confirmPassword) {
      setFieldError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await firstPartyAuthClient.resetPassword(token, password);
      // Clear sensitive form state after completion
      setPassword('');
      setConfirmPassword('');
      setToken(null);
      setResetSuccess(true);
    } catch (resetErr: unknown) {
      setError(
        authErrorMessage(resetErr) || 'Unable to reset password. The link may have expired or already been used.',
      );
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
        <h1 className="text-2xl font-semibold text-forest">Set new password</h1>
        <p className="mt-1 text-sm text-muted">
          Choose a strong password of at least 12 characters.
        </p>
      </div>

      {resetSuccess ? (
        <div className="rounded-card border border-success/20 bg-success-surface/60 p-5 text-center" role="status">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success mb-2" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Password reset successful!</h2>
          <p className="mt-1 text-sm text-muted">
            Your password has been updated. All previous active sessions have been signed out for security.
          </p>
          <div className="mt-6">
            <Link to="/login">
              <Button variant="primary" className="w-full">
                Sign in with new password
              </Button>
            </Link>
          </div>
        </div>
      ) : tokenMissing ? (
        <div className="space-y-5">
          <ErrorState
            title="Missing reset token"
            message="No password reset token was provided or the link is incomplete. Please request a new reset link."
          />
          <div className="pt-2">
            <Link to="/forgot-password">
              <Button variant="secondary" className="w-full">
                Request new reset link
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {error ? (
            <div className="mb-5">
              <ErrorState title="Password reset failed" message={error} />
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="relative">
              <TextField
                label="New password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-11"
                placeholder="At least 12 characters"
                hint="Minimum 12 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute top-[30px] right-1 flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-soft-sage hover:text-forest"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <TextField
              label="Confirm new password"
              type={showPassword ? 'text' : 'password'}
              name="confirmPassword"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={fieldError}
              placeholder="Repeat your new password"
            />

            <Button
              type="submit"
              className="w-full mt-2"
              loading={submitting}
              disabled={!password || !confirmPassword}
              icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
            >
              Update password
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}
