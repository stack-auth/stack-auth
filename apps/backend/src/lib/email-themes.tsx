import { Body, Html, render } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import { DarkEmailTheme, LightEmailTheme } from "@stackframe/stack-emails/dist/themes/index";

const emailThemes = {
  light: LightEmailTheme,
  dark: DarkEmailTheme,
} as const;


export async function renderEmailWithTheme(htmlContent: string, theme: keyof typeof emailThemes, unsubscribeLink: string | null) {
  const TemplateComponent = emailThemes[theme];
  const Email = (
    <Html>
      <Tailwind>
        <Body>
          <TemplateComponent>
            <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
            {unsubscribeLink && (
              <>
                <br /><br />
                <a href={unsubscribeLink}>Click here to unsubscribe</a>
              </>
            )}
          </TemplateComponent>
        </Body>
      </Tailwind>
    </Html>
  );
  return {
    html: await render(Email),
    text: await render(Email, { plainText: true }),
  };
}
