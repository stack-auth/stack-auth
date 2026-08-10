// Only the scrubber is exported at this layer. The issues API scrubs event
// payloads before projecting them, so the scrubber lands with the issues
// surface; the rest of the ingest pipeline (envelope parsing, policy,
// client reports, outcomes) arrives with the error-ingest surface that
// produces those payloads in the first place.
export {
  DEFAULT_ERROR_INGEST_SCRUB_LIMITS,
  scrubErrorIngestPayload,
  type ErrorIngestScrubbedValue,
  type ErrorIngestScrubLimits,
  type ErrorIngestScrubOptions,
  type ErrorIngestScrubOverrides,
  type ErrorIngestScrubResult,
} from "./error-ingest-scrubber";
