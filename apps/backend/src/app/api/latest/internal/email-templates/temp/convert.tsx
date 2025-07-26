import { TEditorConfiguration } from "@stackframe/stack-emails/dist/editor/documents/editor/core";
import { EmailTemplateMetadata } from "@stackframe/stack-emails/dist/utils";

// Helper function to convert handlebars syntax to JSX syntax
function convertHandlebarsToJSX(text: string): string {
  if (!text) return '""';

  const ifBlockRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

  // Helper to convert plain text + variable placeholders to string concatenation pieces
  const handlebarsToConcat = (snippet: string): string => {
    const parts = snippet.split(/(\{\{\s*\w+\s*\}\})/g).filter(Boolean);
    const mapped = parts.map((part) => {
      const varMatch = part.match(/\{\{\s*(\w+)\s*\}\}/);
      if (varMatch) return varMatch[1]; // just the variable name
      // JSON.stringify to safely quote the static text
      return JSON.stringify(part);
    });
    return mapped.join(' + ');
  };

  let transformed = text.replace(ifBlockRegex, (_match, variable: string, content: string) => {
    const concatContent = handlebarsToConcat(content);
    return `\${${variable} ? (${concatContent}) : ''}`;
  });

  // Replace remaining simple variables {{ var }}
  transformed = transformed.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v: string) => `\${${v}}`);

  // Escape backticks in original literal fragments to preserve outer template literal integrity
  transformed = transformed.replace(/`/g, '\\`');

  const singleVarMatch = transformed.match(/^\${(\w+)}$/);
  if (singleVarMatch) return `\`$\{${singleVarMatch[1]}\}\``;

  if (!transformed.includes('${')) {
    return `"${transformed.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }

  return `\`${transformed.replace(/\n/g, '\\n')}\``;
}

export function generateTsxSourceFromConfiguration(configuration: TEditorConfiguration, variables: string[], subject: string): string {
  const rootBlock = configuration.root;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!rootBlock) {
    throw new Error("Root block not found in configuration");
  }

  // Helper function to convert font family enum to CSS font family
  const getFontFamily = (fontFamily: string | null | undefined): string => {
    switch (fontFamily) {
      case 'MODERN_SANS': {
        return '"Helvetica Neue", "Arial Nova", "Nimbus Sans", Arial, sans-serif';
      }
      case 'BOOK_SANS': {
        return 'Optima, Candara, "Noto Sans", source-sans-pro, sans-serif';
      }
      case 'ORGANIC_SANS': {
        return 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif';
      }
      case 'GEOMETRIC_SANS': {
        return 'Avenir, "Avenir Next LT Pro", Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif';
      }
      case 'HEAVY_SANS': {
        return 'Bahnschrift, "DIN Alternate", "Franklin Gothic Medium", "Nimbus Sans Narrow", sans-serif-condensed, sans-serif';
      }
      case 'ROUNDED_SANS': {
        return 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT Bold", Calibri, source-sans-pro, sans-serif';
      }
      case 'MODERN_SERIF': {
        return 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif';
      }
      case 'BOOK_SERIF': {
        return '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif';
      }
      case 'MONOSPACE': {
        return '"Nimbus Mono PS", "Courier New", "Cutive Mono", monospace';
      }
      default: {
        return 'Arial, sans-serif';
      }
    }
  };

  // Helper function to convert padding object to CSS padding string
  const getPadding = (padding: { top: number, bottom: number, right: number, left: number } | null | undefined): string => {
    if (!padding) {
      return '0';
    }
    return `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;
  };

  // Helper function to render a single block
  const renderBlock = (blockId: string, depth: number = 0): string => {
    const block = configuration[blockId];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!block) {
      return '';
    }

    const indent = '  '.repeat(depth);

    switch (block.type) {
      case 'EmailLayout': {
        const { backdropColor, canvasColor, textColor, fontFamily, childrenIds } = block.data;
        const children = childrenIds?.map(childId => renderBlock(childId, depth + 5)).join('\n') || '';

        return `${indent}<div
${indent}  style={{
${indent}    backgroundColor: '${backdropColor || '#F5F5F5'}',
${indent}    color: '${textColor || '#262626'}',
${indent}    fontFamily: '${getFontFamily(fontFamily)}',
${indent}    fontSize: '16px',
${indent}    fontWeight: '400',
${indent}    letterSpacing: '0.15008px',
${indent}    lineHeight: '1.5',
${indent}    margin: '0',
${indent}    padding: '32px 0',
${indent}    minHeight: '100%',
${indent}    width: '100%',
${indent}  }}
${indent}>
${indent}  <table
${indent}    align="center"
${indent}    width="100%"
${indent}    style={{
${indent}      margin: '0 auto',
${indent}      maxWidth: '600px',
${indent}      backgroundColor: '${canvasColor || '#FFFFFF'}',
${indent}    }}
${indent}    role="presentation"
${indent}    cellSpacing="0"
${indent}    cellPadding="0"
${indent}    border={0}
${indent}  >
${indent}    <tbody>
${indent}      <tr style={{ width: '100%' }}>
${indent}        <td>
${children}
${indent}        </td>
${indent}      </tr>
${indent}    </tbody>
${indent}  </table>
${indent}</div>`;
      }

      case 'Text': {
        const { style, props } = block.data;
        const text = props?.text || '';
        const jsxText = convertHandlebarsToJSX(text).slice(1, -1);
        const parseText = (text: string) => {
          const regex = /\[(.*?)\]\((.*?)\)|\*\*(.*?)\*\*/g;
          const parts = [];
          let lastIndex = 0;
          let match;

          while ((match = regex.exec(text)) !== null) {
            // Add text before the match
            if (match.index > lastIndex) {
              parts.push(`{\`${text.substring(lastIndex, match.index)}\`}`);
            }

            if (match[1] && match[2]) {
              // Hyperlink
              parts.push(`
                <a
                  key={${match.index}}
                  href={\`${match[2]}\`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'blue', textDecoration: 'underline' }}
                >
                  {\`${match[1]}\`}
                </a>`
              );
            } else if (match[3]) {
              parts.push(`
                <strong key={${match.index}}>
                  {\`${match[3]}\`}
                </strong>`
              );
            }

            lastIndex = match.index + match[0].length;
          }

          // Add remaining text after the last match
          if (lastIndex < text.length) {
            parts.push(`{\`${text.substring(lastIndex)}\`}`);
          }

          return parts;
        };

        return `${indent}<p
${indent}  style={{
${indent}    color: '${style?.color || '#000000'}',
${indent}    backgroundColor: '${style?.backgroundColor || 'transparent'}',
${indent}    fontSize: ${style?.fontSize || 16},
${indent}    fontFamily: '${getFontFamily(style?.fontFamily)}',
${indent}    fontWeight: '${style?.fontWeight || 'normal'}',
${indent}    textAlign: '${style?.textAlign || 'left'}',
${indent}    padding: '${getPadding(style?.padding)}',
${indent}    margin: 0,
${indent}  }}
${indent}>
${indent}  ${parseText(jsxText).join('\n')}
${indent}</p>`;
      }

      case 'Heading': {
        const { style, props } = block.data;
        const text = props?.text || '';
        const jsxText = convertHandlebarsToJSX(text);
        const level = props?.level || 'h2';
        const fontSize = level === 'h1' ? 32 : level === 'h2' ? 24 : 20;

        return `${indent}<${level}
${indent}  style={{
${indent}    color: '${style?.color || '#000000'}',
${indent}    backgroundColor: '${style?.backgroundColor || 'transparent'}',
${indent}    fontFamily: '${getFontFamily(style?.fontFamily)}',
${indent}    fontWeight: '${style?.fontWeight || 'bold'}',
${indent}    textAlign: '${style?.textAlign || 'left'}',
${indent}    fontSize: ${fontSize},
${indent}    padding: '${getPadding(style?.padding)}',
${indent}    margin: 0,
${indent}  }}
${indent}>
${indent}  {${jsxText}}
${indent}</${level}>`;
      }

      case 'Button': {
        const { style, props } = block.data;
        const text = props?.text || '';
        const jsxText = convertHandlebarsToJSX(text);
        const url = props?.url || '';
        const jsxUrl = convertHandlebarsToJSX(url);
        const buttonBackgroundColor = props?.buttonBackgroundColor || '#f0f0f0';
        const buttonTextColor = props?.buttonTextColor || '#000000';
        const buttonStyle = props?.buttonStyle || 'rounded';
        const fullWidth = props?.fullWidth || false;
        const size = props?.size || 'medium';

        // Calculate button size padding
        const buttonPadding = size === 'x-small' ? '4px 8px' :
          size === 'small' ? '8px 12px' :
            size === 'large' ? '16px 32px' :
              '12px 20px';

        // Calculate border radius
        const borderRadius = buttonStyle === 'rectangle' ? '0' :
          buttonStyle === 'pill' ? '64px' :
            '4px';

        return `${indent}<div
${indent}  style={{
${indent}    backgroundColor: '${style?.backgroundColor || 'transparent'}',
${indent}    textAlign: '${style?.textAlign || 'left'}',
${indent}    padding: '${getPadding(style?.padding)}',
${indent}  }}
${indent}>
${indent}  <Button
${indent}    href={${jsxUrl}}
${indent}    style={{
${indent}      color: '${buttonTextColor}',
${indent}      fontSize: ${style?.fontSize || 16},
${indent}      fontFamily: '${getFontFamily(style?.fontFamily)}',
${indent}      fontWeight: '${style?.fontWeight || 'bold'}',
${indent}      backgroundColor: '${buttonBackgroundColor}',
${indent}      borderRadius: '${borderRadius}',
${indent}      display: '${fullWidth ? 'block' : 'inline-block'}',
${indent}      padding: '${buttonPadding}',
${indent}      textDecoration: 'none',
${indent}      border: 'none',
${indent}    }}
${indent}    target="_blank"
${indent}  >
${indent}    {${jsxText}}
${indent}  </Button>
${indent}</div>`;
      }

      case 'Divider': {
        const { style, props } = block.data;
        const lineColor = props?.lineColor || '#333333';
        const lineHeight = props?.lineHeight || 1;

        return `${indent}<div
${indent}  style={{
${indent}    padding: '${getPadding(style?.padding)}',
${indent}    backgroundColor: '${style?.backgroundColor || 'transparent'}',
${indent}  }}
${indent}>
${indent}  <hr
${indent}    style={{
${indent}      width: '100%',
${indent}      border: 'none',
${indent}      borderTop: \`${lineHeight}px solid ${lineColor}\`,
${indent}      margin: 0,
${indent}    }}
${indent}  />
${indent}</div>`;
      }

      case 'Spacer': {
        const { props } = block.data;
        const height = props?.height || 16;

        return `${indent}<div
${indent}  style={{
${indent}    height: ${height},
${indent}  }}
${indent}/>`;
      }

      case 'Image': {
        const { style, props } = block.data;
        const url = props?.url || '';
        const jsxUrl = convertHandlebarsToJSX(url);
        const alt = props?.alt || '';
        const jsxAlt = convertHandlebarsToJSX(alt);
        const width = props?.width;
        const height = props?.height;
        const linkHref = props?.linkHref;
        const jsxLinkHref = linkHref ? convertHandlebarsToJSX(linkHref) : null;

        const imageElement = `<Img
${indent}    alt={${jsxAlt}}
${indent}    src={${jsxUrl}}
${indent}    ${width ? `width={${width}}` : ''}
${indent}    ${height ? `height={${height}}` : ''}
${indent}    style={{
${indent}      ${width ? `width: ${width},` : ''}
${indent}      ${height ? `height: ${height},` : ''}
${indent}      outline: 'none',
${indent}      border: 'none',
${indent}      textDecoration: 'none',
${indent}      verticalAlign: '${props?.contentAlignment || 'middle'}',
${indent}      display: 'inline-block',
${indent}      maxWidth: '100%',
${indent}    }}
${indent}  />`;

        if (linkHref) {
          return `${indent}<div
${indent}  style={{
${indent}    padding: '${getPadding(style?.padding)}',
${indent}    backgroundColor: '${style?.backgroundColor || 'transparent'}',
${indent}    textAlign: '${style?.textAlign || 'left'}',
${indent}  }}
${indent}>
${indent}  <a href={${jsxLinkHref}} style={{ textDecoration: 'none' }} target="_blank">
${indent}    ${imageElement}
${indent}  </a>
${indent}</div>`;
        }

        return `${indent}<div
${indent}  style={{
${indent}    padding: '${getPadding(style?.padding)}',
${indent}    backgroundColor: '${style?.backgroundColor || 'transparent'}',
${indent}    textAlign: '${style?.textAlign || 'left'}',
${indent}  }}
${indent}>
${indent}  ${imageElement}
${indent}</div>`;
      }

      case 'Container': {
        const { style, props } = block.data;
        const childrenIds = props?.childrenIds || [];
        const children = childrenIds.map(childId => renderBlock(childId, depth + 1)).join('\n');

        return `${indent}<Container
${indent}  style={{
${indent}    backgroundColor: '${childrenIds.length > 0 ? style?.backgroundColor ?? 'transparent' : 'transparent'}',
${indent}    ${style?.borderColor ? `border: '1px solid ${style.borderColor}',` : ''}
${indent}    ${style?.borderRadius ? `borderRadius: ${style.borderRadius},` : ''}
${indent}    padding: '0',
${indent}  }}
${indent}>
${children}
${indent}</Container>`;
      }

      default: {
        return '';
      }
    }
  };

  const propsInterface = variables.map(varName => `${varName}`).join(', ');
  const componentBody = renderBlock('root', 1);

  return `import { type } from "arktype"
import { Button, Container, Img } from "@react-email/components";
import { Subject, NotificationCategory } from "@stackframe/emails";

export const schema = type({
  ${variables.map(v => `${v}: "string"`).join(",\n  ")}
})

export function EmailTemplate({ ${propsInterface} }: typeof schema.infer) {
  return (
    <>
      <Subject value={${convertHandlebarsToJSX(subject)}} />
      <NotificationCategory value="Transactional" />
      ${componentBody.split("\n").join("\n      ")}
    </>
  );
}`;
}

export function getTransformedTemplateMetadata(metadata: EmailTemplateMetadata) {
  const variableNames = metadata.variables.map(v => v.name);
  const configuration = metadata.defaultContent[2];

  return {
    displayName: metadata.label,
    tsxSource: generateTsxSourceFromConfiguration(configuration, variableNames, metadata.defaultSubject),
    themeId: false, // we want migrated templates to use no theme
  };
}
