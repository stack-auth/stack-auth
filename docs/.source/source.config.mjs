// source.config.ts
import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema
} from "fumadocs-mdx/config";
import { z } from "zod";
var extendedFrontmatterSchema = frontmatterSchema.extend({
  lastModified: z.string().optional()
});
var docs = defineDocs({
  docs: {
    schema: extendedFrontmatterSchema
  },
  meta: {
    schema: metaSchema
  }
});
var api = defineDocs({
  dir: "./content/api",
  docs: {
    schema: extendedFrontmatterSchema
  },
  meta: {
    schema: metaSchema
  }
});
var source_config_default = defineConfig({
  mdxOptions: {
    // MDX options
  }
});
export {
  api,
  source_config_default as default,
  docs
};
