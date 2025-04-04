import logoDarkMode from "../../public/logo-bright.svg";
import logoFullDarkMode from "../../public/logo-full-bright.svg";
import logoFullLightMode from "../../public/logo-full.svg";
import logoLightMode from "../../public/logo.svg";
import { Link } from "./link";
import { SmartImage } from "./smart-image";

type ImageProps = React.ComponentProps<typeof SmartImage>;

export function Logo(props: (ImageProps | Omit<ImageProps, "src" | "alt">) & { full?: boolean, href?: string, noLink?: boolean }) {
  const { full, noLink, ...imageProps } = props;
  const logos = {
    light: props.full ? logoFullLightMode : logoLightMode,
    dark: props.full ? logoFullDarkMode : logoDarkMode,
  };

  const Component = noLink ? "span" : Link;

  return (
    <>
      <Component href={noLink ? undefined as any : props.href || "/"} className="block dark:hidden">
        <SmartImage src={logos.light} alt="Logo" priority {...imageProps} placeholder="empty" />
      </Component>
      <Component href={noLink ? undefined as any : props.href || "/"} className="hidden dark:block">
        <SmartImage src={logos.dark} alt="Logo" priority {...imageProps} placeholder="empty" />
      </Component>
    </>
  );
}
