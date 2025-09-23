# API migrations

First, make sure you have a good reason to do an API migration. While they're relatively low-effort in our codebase, most changes don't break backwards compatibility, so it might not be required.

Examples of changes that are breaking and hence require an API migration:

- You are adding a required field to a request, or narrowing the allowed values of an existing request field
- You are removing a field of a response, or widening the allowed values for a response field
- You are renaming a field or endpoint
- You are removing an endpoint entirely
- The behavior changes in other ways that might affect clients
- ...

Release versions (eg. v1, v2) are documented thoroughly, while beta versions (eg. v2beta1, v3beta2) are mostly used by our own packages/SDKs and some external beta testers. **We still need to maintain backwards compatibility for beta versions**, so the only purpose of differentiating is to prevent "migration fatigue" if we were to announce a new API version every week. Beta versions come before release versions: `v1 < v2beta1 < v2beta2 < v2`, etc.

Each folder in `src/app/api/migrations` is a migration. The name of the folder is the name of the version you're migrating **to** — so, if you're migrating from `v2beta3` to `v2beta4`, the folder is called `v2beta4`. In other words, the files in `v2beta4` will process all requests for versions LESS than `v2beta4` (but not `v2beta4` itself).

To create a new migration, simply add a new folder in `src/app/api/migrations`. This folder has the same structure as `src/app/api/latest`, although it will fall back to that folder for routes that are not found. Additionally, this new folder should contain extra files: `beta-changes.txt` (the list of changes since the last beta version), and `release-changes.txt` (the list of changes since the last release version — only required for release versions). For every endpoint you migrate, you will likely also have to modify the most recent migration of that endpoint in previous versions (if any) to call your newly created endpoint, instead of the one that can be found in `latest`.

To understand the flow of old migrations, imagine a request for a `v2` endpoint. Instead of looking for a Next.js file in the `src/app/api` folder directly, the middleware will instead rewrite the request to `src/app/api/migrations/v2beta1`. If not found, it will check `v2beta2`, and so on. If no migration strictly newer than the requested version is found, it will return the route from `src/app/api/latest`.


