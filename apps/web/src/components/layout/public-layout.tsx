import { Menu, Sprout, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Brand } from '@/components/brand';
import { buttonStyles } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const publicLinks = [
  { to: '/plants', label: 'Plant Library' },
  { to: '/about', label: 'About' },
];

export function PublicLayout() {
  const { status } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === 'authenticated';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-page/90 backdrop-blur">
        <div className="container-page flex h-[72px] items-center justify-between gap-4">
          <Brand showTagline />

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {publicLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-control px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-soft-sage text-forest' : 'text-muted hover:text-forest',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {signedIn ? (
              <Link to="/dashboard" className={buttonStyles('primary', 'sm')}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className={buttonStyles('ghost', 'sm')}>
                  Log in
                </Link>
                <Link to="/register" className={buttonStyles('primary', 'sm')}>
                  Start Growing
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-control border border-line-strong bg-card text-forest md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen ? (
          <div id="public-mobile-menu" className="border-t border-line bg-page px-4 py-4 md:hidden">
            <nav className="space-y-1" aria-label="Mobile navigation">
              {publicLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-control px-3 py-2.5 text-sm font-medium',
                      isActive ? 'bg-soft-sage text-forest' : 'text-muted',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
              {signedIn ? (
                <Link
                  to="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className={buttonStyles('primary')}
                >
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setMenuOpen(false)}
                    className={buttonStyles('secondary')}
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMenuOpen(false)}
                    className={buttonStyles('primary')}
                  >
                    Start Growing
                  </Link>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-line bg-card">
        <div className="container-page py-10">
          <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <Brand />
              <p className="mt-3 max-w-sm text-sm text-muted">
                A clearer way to manage small gardens, readings, and care tasks — with or without
                IoT hardware.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-forest">Explore</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li>
                  <Link className="hover:text-forest" to="/plants">
                    Plant Library
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-forest" to="/about">
                    About GrowSpace
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-forest" to="/register">
                    Create an account
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-forest">Data honesty</h2>
              <p className="mt-3 text-sm text-muted">
                Simulated values are always labeled. Manual entries are never presented as verified
                sensor readings.
              </p>
            </div>
          </div>
          <div className="mt-8 flex flex-col justify-between gap-3 border-t border-line pt-6 text-xs text-muted sm:flex-row">
            <p className="flex items-center gap-2">
              <Sprout className="h-4 w-4 text-sage" aria-hidden="true" />
              GrowSpace MVP · Grow smarter. Grow naturally.
            </p>
            <p>Reference guidance only. Not a substitute for expert agricultural advice.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
