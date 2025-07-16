import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { writeFileSyncIfChanged } from '@stackframe/stack-shared/dist/utils/fs';
import { replaceAll } from '@stackframe/stack-shared/dist/utils/strings';
import autoprefixer from 'autoprefixer';
import * as fs from 'fs';
import * as path from 'path';
import postcss from 'postcss';
import postcssNested from 'postcss-nested';

const scopeSelector = ':where(.stack-scope)';

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error('Please provide exactly three arguments: input file path and output file path');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);

  let content = fs.readFileSync(inputPath, 'utf8');

  // set the scope and sentinel, sentinel is used for same level selectors later
  content = `${scopeSelector}, .--stack-sentinel-- {\n${content}\n}`;

  // use postcss to nest the scope
  content = await postcss([autoprefixer, postcssNested]).process(content, { from: undefined }).css;

  // swap the case like .scope img to img.scope
  content = content.replace(/(\.--stack-sentinel--\s)([*a-zA-Z0-9\-]+)([^,{\n]*)/g, `$2${scopeSelector}$3`)

  // swap the case like .scope [data-foo="bar"] to [data-foo="bar"] .scope
  content = content.replace(/(\.--stack-sentinel--\s)(\[.*?\])([^,{\n]*)/g, `$2 ${scopeSelector}$3`)

  // replace the remaining sentinels
  content = replaceAll(content, '.--stack-sentinel-- ', scopeSelector);

  // remove all :root
  content = replaceAll(content, ':root', '');

  // double check that all sentinels were replaced
  if (content.includes('--stack-sentinel--')) {
    throw new StackAssertionError('Sentinel not replaced', { content });
  }

  // output css file for debugging
  writeFileSyncIfChanged(outputPath.replace(/\.ts$/, '.css'), content);

  content = JSON.stringify(content);
  content = `export const globalCSS = ${content};\n`;

  writeFileSyncIfChanged(outputPath, content);

}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
