import { Link } from '@/components/link';
import { Separator, Typography } from '@stackframe/stack-ui';
import { FaDiscord, FaGithub, FaLinkedin } from 'react-icons/fa';

export default function Footer() {
  return (
    <footer className="mt-8">
      <div className="rounded-[24px] border border-white/40 bg-white/75 p-5 shadow-[0_16px_32px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-col gap-5 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex flex-col gap-4">
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500/70 dark:text-slate-300/60">
              Stay Connected
            </div>
            <ul className="flex gap-4">
              {[
                { href: 'https://discord.stack-auth.com/', icon: FaDiscord },
                { href: 'https://www.linkedin.com/company/stackframe-inc', icon: FaLinkedin },
                { href: 'https://github.com/stack-auth/stack-auth', icon: FaGithub },
              ].map(({ href, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/80 shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition hover:shadow-[0_12px_28px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-white/10">
                    <Icon size={18} className="text-slate-600 dark:text-slate-200" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <Separator className="bg-white/60 dark:bg-white/10" />

          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500/70 dark:text-slate-300/60">
              Helpful Links
            </div>
            <div className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              {[
                { href: 'https://stack-auth.com', label: 'Home' },
                { href: 'https://www.iubenda.com/privacy-policy/19290387', label: 'Privacy policy' },
                { href: 'https://www.iubenda.com/privacy-policy/19290387/cookie-policy', label: 'Cookie policy' },
                { href: 'https://www.iubenda.com/terms-and-conditions/19290387', label: 'Terms & conditions' },
              ].map(({ href, label }) => (
                <Link key={label} href={href} className="flex items-center justify-between rounded-xl border border-white/40 bg-white/60 px-3 py-2 shadow-[0_10px_20px_rgba(15,23,42,0.08)] transition hover:shadow-[0_14px_28px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                  <Typography variant="secondary" type="label">
                    {label}
                  </Typography>
                  <span className="text-xs text-slate-400 dark:text-slate-500">↗</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
