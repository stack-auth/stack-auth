# HexclaveAdminApp feature flag transport

HexclaveAdminApp extends HexclaveServerApp and exposes the following internal control-plane operations:

- `testFeatureFlags(request)` -> exposure-free evaluation through `POST /api/v1/internal/feature-flags/test`
- `listFeatureFlagExperimentRuns(experimentId?)`
- `getFeatureFlagExperimentRun(runId)`
- `startFeatureFlagExperimentRun(runId)`
- `pauseFeatureFlagExperimentRun(runId)`
- `resumeFeatureFlagExperimentRun(runId)`
- `completeFeatureFlagExperimentRun(runId)`
- `getFeatureFlagExperimentResults(runId)`
- `listFeatureFlagActivity({ cursor?, limit? })`

Run reads use `/api/v1/internal/feature-flags/experiment-runs`; lifecycle transitions append `/start`, `/pause`, `/resume`, or `/complete`; results append `/results`; activity uses `/api/v1/internal/feature-flags/activity`. All requests use admin authentication. IDs and query values must be URL encoded. The SDK transports immutable run/result/activity payloads without reproducing backend lifecycle or statistics logic.
