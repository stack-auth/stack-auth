import { describe, expect, it } from 'vitest';
import { renderEmailsForTenancyBatched, type RenderEmailRequestForTenancy } from './email-rendering';

describe('renderEmailsForTenancyBatched', () => {
  const createSimpleTemplateSource = (content: string) => `
    export const variablesSchema = (v: any) => v;
    export function EmailTemplate({ variables, user, project }: any) {
      return (
        <>
          <div className="content">${content}</div>
          <div className="user">{user.displayName}</div>
          <div className="project">{project.displayName}</div>
          {variables && <div className="variables">{JSON.stringify(variables)}</div>}
        </>
      );
    }
  `;

  const createTemplateWithSubject = (subject: string, content: string) => `
    import { Subject } from "@stackframe/emails";
    export const variablesSchema = (v: any) => v;
    export function EmailTemplate({ variables, user, project }: any) {
      return (
        <>
          <Subject value="${subject}" />
          <div className="content">${content}</div>
          <div className="user">{user.displayName}</div>
        </>
      );
    }
  `;

  const createTemplateWithNotificationCategory = (category: string, content: string) => `
    import { NotificationCategory } from "@stackframe/emails";
    export const variablesSchema = (v: any) => v;
    export function EmailTemplate({ variables, user, project }: any) {
      return (
        <>
          <NotificationCategory value="${category}" />
          <div className="content">${content}</div>
        </>
      );
    }
  `;

  const createSimpleThemeSource = () => `
    export function EmailTheme({ children, unsubscribeLink }: any) {
      return (
        <div className="email-theme">
          <header>Email Header</header>
          <main>{children}</main>
          {unsubscribeLink && <footer><a href={unsubscribeLink}>Unsubscribe</a></footer>}
        </div>
      );
    }
  `;

  const createMockRequest = (
    index: number,
    overrides?: Partial<RenderEmailRequestForTenancy>
  ): RenderEmailRequestForTenancy => ({
    templateSource: overrides?.templateSource ?? createSimpleTemplateSource(`Template content ${index}`),
    themeSource: overrides?.themeSource ?? createSimpleThemeSource(),
    input: {
      user: { displayName: overrides?.input?.user.displayName ?? `User ${index}` },
      project: { displayName: overrides?.input?.project.displayName ?? `Project ${index}` },
      variables: overrides?.input ? overrides.input.variables : undefined,
      unsubscribeLink: overrides?.input ? overrides.input.unsubscribeLink : `https://example.com/unsubscribe/${index}`,
    },
  });

  describe('empty array input', () => {
    it('should return empty array for empty requests', async () => {
      const result = await renderEmailsForTenancyBatched([]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toEqual([]);
        expect(result.data).toHaveLength(0);
      }
    });
  });

  describe('single request', () => {
    it('should successfully render email for single request', async () => {
      const request = createMockRequest(1);
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].html).toBeDefined();
        expect(result.data[0].text).toBeDefined();
        expect(result.data[0].html).toContain('Template content 1');
        expect(result.data[0].html).toContain('User 1');
        expect(result.data[0].html).toContain('Project 1');
        expect(result.data[0].html).toContain('Email Header');
        expect(result.data[0].html).toContain('Unsubscribe');
        expect(result.data[0].text).toContain('User 1');
      }
    });

    it('should render email with subject when specified', async () => {
      const request = createMockRequest(1, {
        templateSource: createTemplateWithSubject('Test Subject', 'Email body content'),
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].subject).toBe('Test Subject');
        expect(result.data[0].html).toContain('Email body content');
      }
    });

    it('should render email with notification category when specified', async () => {
      const request = createMockRequest(1, {
        templateSource: createTemplateWithNotificationCategory('Transactional', 'Transaction email'),
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].notificationCategory).toBe('Transactional');
        expect(result.data[0].html).toContain('Transaction email');
      }
    });

    it('should handle request without variables', async () => {
      const request = createMockRequest(1, {
        input: {
          user: { displayName: 'John Doe' },
          project: { displayName: 'My Project' },
        },
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].html).toContain('John Doe');
        expect(result.data[0].html).toContain('My Project');
      }
    });

    it('should handle request with variables', async () => {
      const request = createMockRequest(1, {
        input: {
          user: { displayName: 'Jane Doe' },
          project: { displayName: 'Test Project' },
          variables: { greeting: 'Hello', name: 'World' },
        },
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].html).toContain('Jane Doe');
        expect(result.data[0].html).toContain('Test Project');
      }
    });

    it('should handle request without unsubscribe link', async () => {
      const request = createMockRequest(1, {
        input: {
          user: { displayName: 'User 1' },
          project: { displayName: 'Project 1' },
        },
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].html).toBeDefined();
      }
    });

    it('should handle user with null displayName', async () => {
      const request = createMockRequest(1, {
        input: {
          user: { displayName: null },
          project: { displayName: 'Project 1' },
        },
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].html).toBeDefined();
      }
    });
  });

  describe('multiple requests', () => {
    it('should successfully render emails for multiple requests', async () => {
      const requests = [
        createMockRequest(1),
        createMockRequest(2),
        createMockRequest(3),
      ];
      const result = await renderEmailsForTenancyBatched(requests);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(3);

        expect(result.data[0].html).toContain('Template content 1');
        expect(result.data[0].html).toContain('User 1');
        expect(result.data[0].html).toContain('Project 1');

        expect(result.data[1].html).toContain('Template content 2');
        expect(result.data[1].html).toContain('User 2');
        expect(result.data[1].html).toContain('Project 2');

        expect(result.data[2].html).toContain('Template content 3');
        expect(result.data[2].html).toContain('User 3');
        expect(result.data[2].html).toContain('Project 3');
      }
    });

    it('should handle requests with different templates and themes', async () => {
      const requests = [
        createMockRequest(1, {
          templateSource: createSimpleTemplateSource('Custom Template 1'),
          themeSource: `
            export function EmailTheme({ children }: any) {
              return <div className="custom-theme-1">{children}</div>;
            }
          `,
        }),
        createMockRequest(2, {
          templateSource: createSimpleTemplateSource('Custom Template 2'),
          themeSource: `
            export function EmailTheme({ children }: any) {
              return <div className="custom-theme-2">{children}</div>;
            }
          `,
        }),
      ];
      const result = await renderEmailsForTenancyBatched(requests);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].html).toContain('Custom Template 1');
        expect(result.data[0].html).toContain('custom-theme-1');
        expect(result.data[1].html).toContain('Custom Template 2');
        expect(result.data[1].html).toContain('custom-theme-2');
      }
    });

    it('should handle mixed requests with and without subjects', async () => {
      const requests = [
        createMockRequest(1, {
          templateSource: createTemplateWithSubject('Subject 1', 'Content 1'),
        }),
        createMockRequest(2, {
          templateSource: createSimpleTemplateSource('Content 2'),
        }),
        createMockRequest(3, {
          templateSource: createTemplateWithSubject('Subject 3', 'Content 3'),
        }),
      ];
      const result = await renderEmailsForTenancyBatched(requests);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(3);
        expect(result.data[0].subject).toBe('Subject 1');
        expect(result.data[1].subject).toBeUndefined();
        expect(result.data[2].subject).toBe('Subject 3');
      }
    });

    it('should handle requests with different users and projects', async () => {
      const requests = [
        createMockRequest(1, {
          input: {
            user: { displayName: 'Alice' },
            project: { displayName: 'Project A' },
          },
        }),
        createMockRequest(2, {
          input: {
            user: { displayName: null },
            project: { displayName: 'Project B' },
          },
        }),
        createMockRequest(3, {
          input: {
            user: { displayName: 'Charlie' },
            project: { displayName: 'Project C' },
          },
        }),
      ];
      const result = await renderEmailsForTenancyBatched(requests);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(3);
        expect(result.data[0].html).toContain('Alice');
        expect(result.data[0].html).toContain('Project A');
        expect(result.data[1].html).toContain('Project B');
        expect(result.data[2].html).toContain('Charlie');
        expect(result.data[2].html).toContain('Project C');
      }
    });
  });

  describe('error handling', () => {
    it('should return error for invalid template syntax', async () => {
      const request = createMockRequest(1, {
        templateSource: 'invalid syntax {{{ not jsx',
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    });

    it('should return error for invalid theme syntax', async () => {
      const request = createMockRequest(1, {
        themeSource: 'export function EmailTheme( { unclosed bracket',
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toBeDefined();
      }
    });

    it('should return error when template does not export EmailTemplate', async () => {
      const request = createMockRequest(1, {
        templateSource: `
          export const variablesSchema = (v: any) => v;
          export function WrongName() {
            return <div>Wrong function name</div>;
          }
        `,
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toBeDefined();
      }
    });

    it('should return error when theme does not export EmailTheme', async () => {
      const request = createMockRequest(1, {
        themeSource: `
          export function WrongThemeName({ children }: any) {
            return <div>{children}</div>;
          }
        `,
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('text rendering', () => {
    it('should render plain text version of email', async () => {
      const request = createMockRequest(1, {
        templateSource: createSimpleTemplateSource('Plain text content'),
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data[0].text).toBeDefined();
        expect(result.data[0].text).toContain('Plain text content');
        expect(result.data[0].text).toContain('User 1');
      }
    });

    it('should render text for multiple emails', async () => {
      const requests = [
        createMockRequest(1),
        createMockRequest(2),
      ];
      const result = await renderEmailsForTenancyBatched(requests);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data[0].text).toBeDefined();
        expect(result.data[1].text).toBeDefined();
        expect(result.data[0].text).not.toBe(result.data[1].text);
      }
    });
  });

  describe('unsubscribe link handling', () => {
    it('should include unsubscribe link when provided', async () => {
      const request = createMockRequest(1, {
        input: {
          user: { displayName: 'User 1' },
          project: { displayName: 'Project 1' },
          unsubscribeLink: 'https://example.com/unsubscribe/abc123',
        },
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data[0].html).toContain('https://example.com/unsubscribe/abc123');
      }
    });

    it('should handle missing unsubscribe link gracefully', async () => {
      const customTheme = `
        export function EmailTheme({ children, unsubscribeLink }: any) {
          return (
            <div>
              <main>{children}</main>
              {unsubscribeLink ? <footer><a href={unsubscribeLink}>Unsubscribe</a></footer> : null}
            </div>
          );
        }
      `;
      const request = createMockRequest(1, {
        themeSource: customTheme,
        input: {
          user: { displayName: 'User 1' },
          project: { displayName: 'Project 1' },
        },
      });
      const result = await renderEmailsForTenancyBatched([request]);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data[0].html).toBeDefined();
      }
    });
  });

  describe('large batch', () => {
    it('should handle rendering 10 emails in a single batch', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => createMockRequest(i + 1));
      const result = await renderEmailsForTenancyBatched(requests);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data).toHaveLength(10);
        result.data.forEach((email, i) => {
          expect(email.html).toContain(`User ${i + 1}`);
          expect(email.html).toContain(`Project ${i + 1}`);
          expect(email.text).toBeDefined();
        });
      }
    }, 30000); // Extended timeout for large batch
  });
});
