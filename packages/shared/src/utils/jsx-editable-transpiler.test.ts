import { describe, it, expect } from 'vitest';
import { transpileJsxForEditing, convertSentinelTokensToComments } from './jsx-editable-transpiler';

describe('transpileJsxForEditing', () => {
  it('should wrap simple JSX text nodes with __Editable', () => {
    const source = `
export function EmailTemplate() {
  return <div>Hello World!</div>;
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    expect(result.code).toContain('__Editable');
    expect(result.code).toContain('Hello World!');
    expect(Object.keys(result.editableRegions).length).toBeGreaterThan(0);

    // Check that the editable region has the expected metadata
    const region = Object.values(result.editableRegions)[0];
    expect(region.originalText).toBe('Hello World!');
    expect(region.sourceFile).toBe('template');
    expect(region.parentElement.tagName).toBe('div');
  });

  it('should handle multiple text nodes in the same element', () => {
    const source = `
export function EmailTemplate({ name }) {
  return <div>Hello, {name}! Welcome to our platform.</div>;
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    // Should have 2 editable regions (text before and after the expression)
    const regions = Object.values(result.editableRegions);
    expect(regions.length).toBe(2);

    const texts = regions.map(r => r.originalText);
    expect(texts).toContain('Hello, ');
    expect(texts).toContain('! Welcome to our platform.');
  });

  it('should skip whitespace-only text nodes', () => {
    const source = `
export function EmailTemplate() {
  return (
    <div>
      <span>Text</span>
    </div>
  );
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    // Should only have 1 editable region (the "Text" in span)
    const regions = Object.values(result.editableRegions);
    expect(regions.length).toBe(1);
    expect(regions[0].originalText).toBe('Text');
  });

  it('should track occurrence count for duplicate text', () => {
    const source = `
export function EmailTemplate() {
  return (
    <div>
      <p>Click here</p>
      <p>Click here</p>
    </div>
  );
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    const regions = Object.values(result.editableRegions);
    expect(regions.length).toBe(2);

    // Both should have occurrenceCount of 2
    expect(regions[0].occurrenceCount).toBe(2);
    expect(regions[1].occurrenceCount).toBe(2);

    // They should have different occurrence indices
    expect(regions[0].occurrenceIndex).toBe(1);
    expect(regions[1].occurrenceIndex).toBe(2);
  });

  it('should capture JSX path correctly', () => {
    const source = `
export function EmailTemplate() {
  return (
    <Container>
      <Section>
        <Text>Hello</Text>
      </Section>
    </Container>
  );
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    const region = Object.values(result.editableRegions)[0];
    expect(region.jsxPath).toContain('EmailTemplate');
    expect(region.jsxPath).toContain('Container');
    expect(region.jsxPath).toContain('Section');
    expect(region.jsxPath).toContain('Text');
  });

  it('should capture parent element props', () => {
    const source = `
export function EmailTemplate() {
  return <Text className="heading" style={{ color: 'red' }}>Title</Text>;
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    const region = Object.values(result.editableRegions)[0];
    expect(region.parentElement.tagName).toBe('Text');
    expect(region.parentElement.props.className).toBe('heading');
  });

  it('should inject __Editable component definition', () => {
    const source = `
export function EmailTemplate() {
  return <div>Test</div>;
}
`;
    const result = transpileJsxForEditing(source, { sourceFile: 'template' });

    expect(result.code).toContain('function __Editable');
    expect(result.code).toContain('STACK_EDITABLE_START');
    expect(result.code).toContain('STACK_EDITABLE_END');
  });
});

describe('convertSentinelTokensToComments', () => {
  it('should convert start tokens to HTML comments', () => {
    const html = '<div>⟦STACK_EDITABLE_START:e0⟧Hello⟦STACK_EDITABLE_END:e0⟧</div>';
    const result = convertSentinelTokensToComments(html);

    expect(result).toBe('<div><!-- STACK_EDITABLE_START e0 -->Hello<!-- STACK_EDITABLE_END e0 --></div>');
  });

  it('should handle multiple editable regions', () => {
    const html = '<div>⟦STACK_EDITABLE_START:e0⟧Hello⟦STACK_EDITABLE_END:e0⟧ ⟦STACK_EDITABLE_START:e1⟧World⟦STACK_EDITABLE_END:e1⟧</div>';
    const result = convertSentinelTokensToComments(html);

    expect(result).toContain('<!-- STACK_EDITABLE_START e0 -->');
    expect(result).toContain('<!-- STACK_EDITABLE_END e0 -->');
    expect(result).toContain('<!-- STACK_EDITABLE_START e1 -->');
    expect(result).toContain('<!-- STACK_EDITABLE_END e1 -->');
  });

  it('should leave regular HTML unchanged', () => {
    const html = '<div><p>Hello World</p></div>';
    const result = convertSentinelTokensToComments(html);

    expect(result).toBe(html);
  });
});
