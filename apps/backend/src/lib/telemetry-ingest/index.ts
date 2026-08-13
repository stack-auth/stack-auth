/**
 * Provider-neutral name for the ingestion boundary.
 *
 * The implementation still lives in error-ingest while the public
 * compatibility surface is being migrated; keeping this barrel lets new
 * analytics, OTLP, and Sentry code use the broader name without breaking
 * existing imports.
 */
export * from "../error-ingest";
