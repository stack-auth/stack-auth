import { Link } from "@/components/link";
import { Separator, Typography } from "@stackframe/stack-ui";
import { FaDiscord, FaGithub, FaLinkedin } from "react-icons/fa";

export default function Footer () {
  return (
    <footer>
      <Separator />

      <div className="flex flex-col md:flex-row p-4 gap-4 backdrop-blur-md bg-white/20 dark:bg-black/20">
        <div className="flex flex-col gap-4 md:flex-1">
          <ul className="flex gap-4 flex-grow">
            {[
              { href: "https://discord.stack-auth.com/", icon: FaDiscord },
              { href: "https://www.linkedin.com/company/stackframe-inc", icon: FaLinkedin },
              { href: "https://github.com/stack-auth/stack-auth", icon: FaGithub },
            ].map(({ href, icon: Icon }) => (
              <li key={href}>
                <Link href={href}>
                  <Icon size={20} className="text-gray-700 dark:text-gray-300" />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-4 md:flex-1 md:justify-end flex-wrap">
          {[
            { href: "https://stack-auth.com", label: "Home" },
            { href: "https://www.iubenda.com/privacy-policy/19290387", label: "Privacy policy" },
            { href: "https://www.iubenda.com/privacy-policy/19290387/cookie-policy", label: "Cookie policy" },
            { href: "https://www.iubenda.com/terms-and-conditions/19290387", label: "Terms & conditions" },
          ].map(({ href, label }) => (
            <Link key={label} href={href}>
              <Typography variant="secondary" type='label'>{label}</Typography>
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
