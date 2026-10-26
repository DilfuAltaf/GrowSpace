import { CheckCircle2, Database, HeartHandshake, Leaf, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonStyles } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const principles = [
  'Turn garden data into understandable, actionable decisions.',
  'Never present simulated values as readings from a real connected sensor.',
  'Explain the reason and a suggested check behind every recommendation.',
  'Keep each account’s gardens, plants, readings, and tasks isolated.',
];

export function AboutPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow">About GrowSpace</p>
        <h1 className="mt-2 text-3xl font-semibold text-forest sm:text-4xl">
          Useful growing technology, without the hardware barrier.
        </h1>
        <p className="mt-4 text-muted sm:text-lg">
          GrowSpace is a responsive web platform for home growers, students, schools, and urban
          gardeners. It brings garden records, environmental readings, care tasks, and plant
          references into one place — and is honest about where data comes from.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Leaf,
            title: 'For small gardens',
            copy: 'Balconies, containers, raised beds, classrooms, and hydroponic setups.',
          },
          {
            icon: HeartHandshake,
            title: 'For beginners',
            copy: 'Plain-language context and next steps, without specialist equipment.',
          },
          {
            icon: Database,
            title: 'For records',
            copy: 'Gardens, plants, readings, logs, and care history kept together.',
          },
        ].map((item) => (
          <Card key={item.title} className="p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-soft-sage text-forest">
              <item.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-forest">{item.title}</h2>
            <p className="mt-1 text-sm text-muted">{item.copy}</p>
          </Card>
        ))}
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-sage" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-forest">Our data principles</h2>
          </div>
          <ul className="mt-4 space-y-3">
            {principles.map((principle) => (
              <li key={principle} className="flex items-start gap-2.5 text-sm text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" aria-hidden="true" />
                {principle}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="bg-forest p-6 text-white">
          <h2 className="text-lg font-semibold">Simulation and manual entry</h2>
          <p className="mt-3 text-sm text-white/75">
            The MVP uses manual readings and seeded demonstration data. Simulated data is labeled
            and explained. Manual entries show when they were recorded. A verified device
            integration is future work, not a current capability.
          </p>
          <p className="mt-4 text-sm text-white/75">
            GrowSpace does not claim measured water savings or improved yields without validated
            data.
          </p>
          <Link
            to="/plants"
            className={buttonStyles('secondary', 'sm', 'mt-5 border-white/30 bg-transparent text-white hover:border-white/60 hover:bg-white/10')}
          >
            Browse the Plant Library
          </Link>
        </Card>
      </div>

      <div className="mt-10 rounded-card border border-line bg-soft-sage/40 p-6">
        <h2 className="text-lg font-semibold text-forest">What the MVP covers</h2>
        <div className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
          {[
            'Public landing page and plant library',
            'Sign up, sign in, and sign out',
            'Garden and plant management',
            'Manual readings and labeled simulation',
            'Historical charts and source labels',
            'Explainable, rule-based recommendations',
            'Care tasks and completion history',
            'Responsive, accessible interface',
          ].map((item) => (
            <p key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" aria-hidden="true" />
              {item}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
