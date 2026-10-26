import { CheckCircle2, Leaf } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { Brand } from '@/components/brand';

const trustPoints = [
  'Hardware-optional monitoring with clear source labels',
  'Plant-specific care guidance, not one universal threshold',
  'Private gardens and records isolated per account',
];

export function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(320px,0.9fr)_1fr]">
      <aside className="relative hidden overflow-hidden bg-forest p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-sage/30 blur-2xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/5 blur-2xl"
          aria-hidden="true"
        />

        <div className="relative">
          <Brand to="/" className="[&_span:first-child]:bg-white/10 [&_span]:text-white" />
        </div>

        <div className="relative max-w-md">
          <p className="eyebrow text-white/60">Grow smarter</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">
            A calm place for gardens, readings, and the next useful action.
          </h1>
          <ul className="mt-8 space-y-3">
            {trustPoints.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-white/80">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#A8C8AC]" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-white/50">
          <Leaf className="h-4 w-4" aria-hidden="true" />
          GrowSpace does not claim live sensor data unless a verified device is connected.
        </p>
      </aside>

      <main className="flex flex-col bg-page">
        <div className="flex items-center justify-between p-5 lg:hidden">
          <Brand showTagline />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
