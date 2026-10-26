import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { authErrorMessage, useAuth } from '@/features/auth/auth-context';
import { safeRedirect } from '@/features/auth/protected-route';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/error-state';

export function LoginPage() {
  const { status, signIn } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = safeRedirect(searchParams.get('redirect'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={redirect} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      navigate(redirect, { replace: true });
    } catch (signInError) {
      setError(authErrorMessage(signInError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-forest">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to continue to your gardens.</p>
      </div>

      {error ? (
        <div className="mb-5">
          <ErrorState title="Sign in failed" message={error} />
        </div>
      ) : null}

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

        <div className="relative">
          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pr-11"
            placeholder="Your password"
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

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="rounded-control text-sm font-medium text-sage hover:text-forest"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          className="w-full"
          loading={submitting}
          disabled={!email.trim() || !password}
          icon={<LogIn className="h-4 w-4" aria-hidden="true" />}
        >
          Sign in
        </Button>
      </form>

      <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
        New to GrowSpace?{' '}
        <Link
          to={`/register?redirect=${encodeURIComponent(redirect)}`}
          className="font-semibold text-sage hover:text-forest"
        >
          Create an account
        </Link>
      </p>
    </Card>
  );
}
