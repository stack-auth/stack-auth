import { ArrowRight, BookOpen, Code2, Hammer, Puzzle, Rocket } from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="relative px-6 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <svg
              width="60"
              height="48"
              viewBox="0 0 200 242"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto mb-6"
            >
              <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
            </svg>
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
            Stack Auth Documentation
          </h1>
          <p className="mb-8 text-lg text-fd-muted-foreground max-w-2xl mx-auto">
            Complete guides and API reference for integrating Stack Auth into your application
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/docs/pages-next/getting-started/setup"
              className="inline-flex items-center px-6 py-3 font-medium text-fd-background bg-fd-foreground rounded-lg hover:bg-fd-foreground/90 transition-colors"
            >
              Quick Start
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center px-6 py-3 font-medium text-fd-foreground bg-fd-accent rounded-lg hover:bg-fd-accent/80 transition-colors"
            >
              Browse Docs
            </Link>
          </div>
        </div>
      </section>

      {/* Platform Selection */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-3">
              Choose Your Platform
            </h2>
            <p className="text-fd-muted-foreground">
              Select your development platform to get started with platform-specific guides
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link
              href="/docs/pages-next"
              className="group p-6 bg-fd-card rounded-xl border hover:bg-fd-accent/50 transition-all"
            >
              <div className="flex items-center mb-3">
                <BookOpen className="h-6 w-6 text-fd-muted-foreground mr-3" />
                <h3 className="font-semibold">Next.js</h3>
              </div>
              <p className="text-sm text-fd-muted-foreground mb-3">
                Full-stack React framework with server-side rendering
              </p>
              <div className="flex items-center text-sm text-fd-foreground group-hover:translate-x-1 transition-transform">
                <span>View Docs</span>
                <ArrowRight className="ml-2 h-3 w-3" />
              </div>
            </Link>

            <Link
              href="/docs/pages-react"
              className="group p-6 bg-fd-card rounded-xl border hover:bg-fd-accent/50 transition-all"
            >
              <div className="flex items-center mb-3">
                <Puzzle className="h-6 w-6 text-fd-muted-foreground mr-3" />
                <h3 className="font-semibold">React</h3>
              </div>
              <p className="text-sm text-fd-muted-foreground mb-3">
                Client-side React applications and SPAs
              </p>
              <div className="flex items-center text-sm text-fd-foreground group-hover:translate-x-1 transition-transform">
                <span>View Docs</span>
                <ArrowRight className="ml-2 h-3 w-3" />
              </div>
            </Link>

            <Link
              href="/docs/pages-js"
              className="group p-6 bg-fd-card rounded-xl border hover:bg-fd-accent/50 transition-all"
            >
              <div className="flex items-center mb-3">
                <Code2 className="h-6 w-6 text-fd-muted-foreground mr-3" />
                <h3 className="font-semibold">JavaScript</h3>
              </div>
              <p className="text-sm text-fd-muted-foreground mb-3">
                Vanilla JavaScript for any web application
              </p>
              <div className="flex items-center text-sm text-fd-foreground group-hover:translate-x-1 transition-transform">
                <span>View Docs</span>
                <ArrowRight className="ml-2 h-3 w-3" />
              </div>
            </Link>

            <Link
              href="/docs/pages-python"
              className="group p-6 bg-fd-card rounded-xl border hover:bg-fd-accent/50 transition-all"
            >
              <div className="flex items-center mb-3">
                <Hammer className="h-6 w-6 text-fd-muted-foreground mr-3" />
                <h3 className="font-semibold">Python</h3>
              </div>
              <p className="text-sm text-fd-muted-foreground mb-3">
                Backend integration for Python applications
              </p>
              <div className="flex items-center text-sm text-fd-foreground group-hover:translate-x-1 transition-transform">
                <span>View Docs</span>
                <ArrowRight className="ml-2 h-3 w-3" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Navigation */}
      <section className="py-16 px-6 bg-fd-accent/20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-3">
              Popular Documentation
            </h2>
            <p className="text-fd-muted-foreground">
              Frequently accessed guides and references
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-fd-card p-6 rounded-lg border">
              <h3 className="font-semibold mb-3">Getting Started</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/docs/pages-next/getting-started/setup" className="text-fd-muted-foreground hover:text-fd-foreground transition-colors">
                    Installation & Setup
                  </Link>
                </li>
                <li>
                  <Link href="/docs/pages-next/getting-started/configuration" className="text-fd-muted-foreground hover:text-fd-foreground transition-colors">
                    Configuration
                  </Link>
                </li>
                <li>
                  <Link href="/docs/pages-next/getting-started/first-app" className="text-fd-muted-foreground hover:text-fd-foreground transition-colors">
                    Your First App
                  </Link>
                </li>
              </ul>
            </div>

            <div className="bg-fd-card p-6 rounded-lg border">
              <h3 className="font-semibold mb-3">Advanced Topics</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/docs/pages-next/advanced/oauth" className="text-fd-muted-foreground hover:text-fd-foreground transition-colors">
                    OAuth Integration
                  </Link>
                </li>
                <li>
                  <Link href="/docs/pages-next/advanced/teams" className="text-fd-muted-foreground hover:text-fd-foreground transition-colors">
                    Team Management
                  </Link>
                </li>
                <li>
                  <Link href="/docs/pages-next/advanced/permissions" className="text-fd-muted-foreground hover:text-fd-foreground transition-colors">
                    Permissions & Roles
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="text-center mt-8">
            <Link
              href="/docs"
              className="inline-flex items-center px-6 py-3 font-medium text-fd-foreground bg-fd-card border rounded-lg hover:bg-fd-accent/50 transition-colors"
            >
              <Rocket className="mr-2 h-4 w-4" />
              Explore All Documentation
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
