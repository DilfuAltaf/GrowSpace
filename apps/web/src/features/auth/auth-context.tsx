import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { firstPartyAuthClient } from './first-party-client';
import {
  FirstPartyAuthError,
  type AuthProviderType,
  type AuthStatus,
  type AuthUser,
} from './types';

export type { AuthStatus, AuthUser, AuthProviderType };

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  provider: AuthProviderType;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: { displayName: string; email: string; password: string }) => Promise<void>;
  signOutUser: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  // Initialize First-Party Session
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      try {
        const sessionUser = await firstPartyAuthClient.getSession();
        if (!isMounted) return;

        if (sessionUser) {
          setUser({
            id: sessionUser.id,
            uid: sessionUser.id,
            email: sessionUser.email,
            displayName: sessionUser.displayName,
            emailVerified: sessionUser.emailVerified,
            temperatureUnit: sessionUser.temperatureUnit,
          });
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('unauthenticated');
        }
      } catch {
        if (!isMounted) return;
        // Never treat network error or server failure as authenticated (fail closed)
        setUser(null);
        setStatus('unauthenticated');
      }
    }

    void initSession();

    const handleSessionExpired = () => {
      if (!isMounted) return;
      setUser(null);
      setStatus('unauthenticated');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('session-expired', handleSessionExpired);
    }

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('session-expired', handleSessionExpired);
      }
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const sessionUser = await firstPartyAuthClient.login({ email, password });
    setUser({
      id: sessionUser.id,
      uid: sessionUser.id,
      email: sessionUser.email,
      displayName: sessionUser.displayName,
      emailVerified: sessionUser.emailVerified,
      temperatureUnit: sessionUser.temperatureUnit,
    });
    setStatus('authenticated');
  }, []);

  const register = useCallback(
    async (input: { displayName: string; email: string; password: string }) => {
      await firstPartyAuthClient.register({
        displayName: input.displayName,
        email: input.email,
        password: input.password,
      });
      // Unverified account policy: Registration does not immediately set an active session
    },
    [],
  );

  const signOutUser = useCallback(async () => {
    try {
      await firstPartyAuthClient.logout();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await firstPartyAuthClient.forgotPassword(email);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      provider: 'first_party',
      signIn,
      register,
      signOutUser,
      resetPassword,
    }),
    [status, user, signIn, register, signOutUser, resetPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof FirstPartyAuthError) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'Email or password is incorrect.';
      case 'rate_limited':
        return 'Too many attempts. Wait a moment and try again.';
      case 'email_unverified':
        return 'Please verify your email address before signing in.';
      case 'forbidden_origin':
        return 'Untrusted request origin.';
      case 'csrf_detected':
        return 'Security validation failed. Please refresh and try again.';
      case 'invalid_token':
        return 'The link or token is invalid, expired, or has already been used.';
      case 'unauthenticated':
        return 'Sign in to continue.';
      default:
        return error.message || 'Something went wrong. Please try again.';
    }
  }

  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
