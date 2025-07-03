import { Body, Html, render } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import { DarkEmailTheme, LightEmailTheme } from "@stackframe/stack-emails/dist/themes/index";

const emailThemes = {
  light: LightEmailTheme,
  dark: DarkEmailTheme,
} as const;


export function renderEmailWithTheme(htmlContent: string, theme: keyof typeof emailThemes) {
  const TemplateComponent = emailThemes[theme];
  const content = <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
  const Email = (
    <Html>
      <Tailwind>
        <Body>
          <TemplateComponent>
            {content}
          </TemplateComponent>
        </Body>
      </Tailwind>
    </Html>
  )
  return {
    html: render(Email),
    text: render(Email, { plainText: true }),
  }
}
