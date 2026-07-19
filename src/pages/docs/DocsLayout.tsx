import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { Footer } from '@/components/Footer';

const DOC_NAV = [
  { path: '/docs', label: 'Overview' },
  { path: '/docs/broadcaster', label: 'Broadcaster' },
  { path: '/docs/receiver', label: 'Receiver' },
  { path: '/docs/admin', label: 'Admin & Users' },
  { path: '/docs/integrations', label: 'Integrations & Shortcuts' },
];

export default function DocsLayout() {
  const { pathname } = useLocation();

  // Scroll to top when navigating to docs or between doc pages (fixes retained scroll from main app)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-[100dvh] bg-background flex">
      <aside className="hidden lg:flex lg:flex-col lg:w-64 shrink-0 border-r border-border p-4 sticky top-0 h-[100dvh] overflow-y-auto">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to app
        </Link>
        <nav className="space-y-1">
          {DOC_NAV.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block py-1.5 px-2 text-xs rounded-md transition-colors truncate ${
                pathname === item.path
                  ? 'text-foreground bg-secondary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pt-6">
          <Footer />
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col min-h-0 max-w-3xl mx-auto w-full px-4 py-12 pb-24">
          <div className="flex items-center gap-3 mb-8">
            <BookOpen className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">QueTal Cast Documentation</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                How to use every feature of the broadcast app
              </p>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <Outlet />
          </div>
          {/* Footer on mobile when sidebar is hidden: gap above, sticks to bottom when content is short */}
          <div className="lg:hidden mt-auto pt-8">
            <Footer />
          </div>
        </div>
      </main>
    </div>
  );
}
