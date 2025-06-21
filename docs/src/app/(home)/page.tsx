import DocsSelector from '@/components/homepage/iconHover';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="relative px-6 py-12 md:py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <svg
              width="80"
              height="64"
              viewBox="0 0 200 242"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto mb-8"
            >
              <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
            </svg>
          </div>

          <h1 className="mb-6 text-5xl md:text-6xl font-bold tracking-tight">
            Stack Auth
            <span className="block text-3xl md:text-4xl font-normal text-fd-muted-foreground mt-2">
              Documentation
            </span>
          </h1>

          <p className="mb-12 text-xl text-fd-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Complete authentication solution with comprehensive guides, API references, and platform-specific examples to get you started quickly.
          </p>

          {/* Documentation Type Selection */}
          <div className="mb-16">
            <DocsSelector />
          </div>
        </div>
      </section>
    </main>
  );
}
