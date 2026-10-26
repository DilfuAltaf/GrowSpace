import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Droplets,
  Leaf,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  Sprout,
  Sun,
  Thermometer,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { buttonStyles } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const features = [
  {
    icon: Sprout,
    title: 'Gardens and plants',
    description: 'Keep growing spaces, plant records, planting dates, and growth stages together.',
  },
  {
    icon: Activity,
    title: 'Readings with sources',
    description: 'Record manual readings and distinguish them from simulated or verified sensor data.',
  },
  {
    icon: BarChart3,
    title: 'Trends over time',
    description: 'Review historical charts with units, timestamps, and clear empty states.',
  },
  {
    icon: Lightbulb,
    title: 'Explainable guidance',
    description: 'See the trigger, the reason, and a suggested check — never a mystery diagnosis.',
  },
  {
    icon: ListChecks,
    title: 'Care tasks',
    description: 'Plan watering, inspections, and harvests, then keep a completion history.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    description: 'Each account can access only its own gardens, plants, readings, and tasks.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create your space',
    description: 'Start with a balcony, classroom bed, or hydroponic setup. Add plants from the library.',
  },
  {
    number: '02',
    title: 'Record what you observe',
    description: 'Enter readings manually or explore clearly labeled simulation data for a demo.',
  },
  {
    number: '03',
    title: 'Act with context',
    description: 'Review trends, read the reason behind a suggestion, and schedule the next care task.',
  },
];

export function LandingPage() {
  const { status } = useAuth();
  const primaryTarget = status === 'authenticated' ? '/dashboard' : '/register';
  const primaryLabel = status === 'authenticated' ? 'Open dashboard' : 'Start Growing';

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_-10%,#E5EDE3_0%,transparent_45%),radial-gradient(circle_at_0%_100%,#EDF3E8_0%,transparent_40%)]"
          aria-hidden="true"
        />
        <div className="container-page relative grid gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
          <div>
            <p className="eyebrow">Smart &amp; urban farming</p>
            <h1 className="mt-3 text-[2.15rem] font-semibold leading-[1.15] text-forest sm:text-5xl lg:text-[3.4rem]">
              Grow smarter.
              <br />
              Grow naturally.
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
              GrowSpace helps you manage small gardens, understand environmental readings, and
              follow care tasks — without needing expensive IoT hardware to begin.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to={primaryTarget} className={buttonStyles('primary')}>
                {primaryLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/plants" className={buttonStyles('secondary')}>
                Explore Plant Library
              </Link>
            </div>

            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {['No hardware required', 'Honest source labels', 'Works on mobile'].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-sage" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div
              className="absolute -top-6 -right-4 h-24 w-24 rounded-full bg-soft-sage/80 blur-xl"
              aria-hidden="true"
            />
            <Card className="relative overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-forest">Balcony Herb Garden</p>
                  <p className="text-xs text-muted">Dashboard preview</p>
                </div>
                <Badge variant="warning">Sample data · simulated</Badge>
              </div>

              <div className="grid grid-cols-3 gap-3 p-5">
                {[
                  { label: 'Moisture', value: '48%', icon: Droplets },
                  { label: 'Air temp', value: '24.2°C', icon: Thermometer },
                  { label: 'Humidity', value: '61%', icon: Sun },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-control border border-line bg-page/60 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                      <metric.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {metric.label}
                    </div>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-forest">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="px-5 pb-2">
                <div className="flex h-24 items-end gap-1.5 rounded-control bg-page/50 px-3 py-3" aria-hidden="true">
                  {[36, 44, 41, 55, 49, 62, 58, 46, 51, 63, 48, 54].map((height, index) => (
                    <span
                      key={index}
                      className="flex-1 rounded-t-sm bg-sage/60"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Illustrative trend. Simulated values are never presented as live sensor readings.
                </p>
              </div>

              <div className="m-5 mt-3 rounded-control border border-warning/20 bg-warning-surface/50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-warning">
                  <Lightbulb className="h-4 w-4" aria-hidden="true" />
                  Example recommendation
                </div>
                <p className="mt-1.5 text-sm text-ink">
                  Media moisture is below the basil reference range. Check the medium at root depth
                  before watering.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="container-page py-14 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">The problem</p>
            <h2 className="mt-2 text-2xl font-semibold text-forest sm:text-3xl">
              Garden records are often scattered and hard to interpret.
            </h2>
          </div>
          <div className="space-y-4 text-muted">
            <p>
              Care notes live in chats, photos, and spreadsheets. Recurring tasks get missed.
              Environmental numbers are hard to connect to a practical next step, and many smart
              farming tools assume sensors or technical setup.
            </p>
            <p className="font-medium text-forest">
              GrowSpace turns those fragments into one calm workflow: garden context, honest data,
              and an action you can understand.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-card">
        <div className="container-page py-14 lg:py-20">
          <div className="max-w-2xl">
            <p className="eyebrow">How it works</p>
            <h2 className="mt-2 text-2xl font-semibold text-forest sm:text-3xl">
              Three steps from observation to action.
            </h2>
          </div>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <li key={step.number} className="rounded-card border border-line bg-page/60 p-5">
                <span className="text-xs font-bold tracking-[0.2em] text-sage">{step.number}</span>
                <h3 className="mt-3 text-lg font-semibold text-forest">{step.title}</h3>
                <p className="mt-1 text-sm text-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container-page py-14 lg:py-20">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow">Features</p>
            <h2 className="mt-2 text-2xl font-semibold text-forest sm:text-3xl">
              Everything needed for a clear growing workflow.
            </h2>
          </div>
          <Link to="/plants" className={buttonStyles('secondary', 'sm')}>
            Browse references
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-control bg-soft-sage text-forest">
                <feature.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-forest">{feature.title}</h3>
              <p className="mt-1 text-sm text-muted">{feature.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-soft-sage/40">
        <div className="container-page grid gap-8 py-14 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:py-16">
          <div>
            <p className="eyebrow">Data honesty</p>
            <h2 className="mt-2 text-2xl font-semibold text-forest sm:text-3xl">
              Know where every number comes from.
            </h2>
            <p className="mt-3 text-sm text-muted">
              GrowSpace treats data source as part of the data. A manual note, a demo dataset, and a
              verified device reading should never look the same.
            </p>
            <Link to="/about" className={buttonStyles('secondary', 'sm', 'mt-5')}>
              Read about our approach
            </Link>
          </div>
          <div className="space-y-3">
            {[
              {
                label: 'Simulated',
                copy: 'Generated demo data, always labeled. Never called a live sensor reading.',
                icon: Badge,
              },
              {
                label: 'Manual entry',
                copy: 'Entered by you, timestamped, and shown with an explicit source label.',
                icon: CheckCircle2,
              },
              {
                label: 'Sensor',
                copy: 'Reserved for a verified device integration. Not available in this release.',
                icon: Leaf,
              },
            ].map((item) => (
              <div key={item.label} className="rounded-card border border-line bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={item.label === 'Simulated' ? 'warning' : item.label === 'Manual entry' ? 'info' : 'success'}>
                    {item.label}
                  </Badge>
                  <CheckCircle2 className="h-4 w-4 text-sage" aria-hidden="true" />
                </div>
                <p className="mt-2 text-sm text-muted">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container-page py-14 lg:py-20">
        <Card className="relative overflow-hidden bg-forest p-8 text-white sm:p-12">
          <div
            className="pointer-events-none absolute -top-20 -right-10 h-64 w-64 rounded-full bg-sage/30 blur-2xl"
            aria-hidden="true"
          />
          <div className="relative max-w-2xl">
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Start with the plants you already have.
            </h2>
            <p className="mt-3 text-sm text-white/75 sm:text-base">
              Build a garden record, add a plant, and record your first reading. GrowSpace will
              explain the context and suggest what to check next.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to={primaryTarget}
                className={buttonStyles('primary', 'md', 'bg-white text-forest hover:bg-soft-sage')}
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/plants"
                className={buttonStyles('secondary', 'md', 'border-white/30 bg-transparent text-white hover:bg-white/10 hover:border-white/50')}
              >
                Browse Plant Library
              </Link>
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
