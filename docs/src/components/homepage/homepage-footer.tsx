import Link from 'next/link';

export default function Footer() {
  const footerLinks = [
    {
      title: "Product",
      links: [
        { name: "Website", href: "https://stack-auth.com" },
        { name: "Dashboard", href: "https://app.stack-auth.com/projects" }
      ]
    },
    {
      title: "Community",
      links: [
        { name: "GitHub", href: "https://github.com/stack-auth/stack-auth" },
        { name: "Discord", href: "https://discord.stack-auth.com/" }
      ]
    },
    {
      title: "Company",
      links: [
        { name: "Careers", href: "https://jobs.gem.com/stack-auth-com" }
      ]
    }
  ];

  return (
    <footer className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-12">
          {/* Logo and Description */}
          <div className="md:col-span-1">
            <div className="flex items-center mb-4">
              <svg
                width="32"
                height="26"
                viewBox="0 0 200 242"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="mr-3"
              >
                <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
              </svg>
              <span className="text-xl font-bold">Stack Auth</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Complete authentication solution for modern applications. Secure, scalable, and developer-friendly.
            </p>
            <div className="flex space-x-1">
              {['rgb(59, 130, 246)', 'rgb(16, 185, 129)', 'rgb(245, 158, 11)', 'rgb(168, 85, 247)'].map((color, index) => (
                <div
                  key={index}
                  className="w-3 h-3 rounded-full opacity-60"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Footer Links */}
          {footerLinks.map((section) => (
            <div key={section.title}>
              <h3 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wide">
                {section.title}
              </h3>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
