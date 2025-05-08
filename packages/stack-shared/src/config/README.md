# Some notes on configs
 
## Generic format vs. Stack Auth

The config format is generally usable and not specific to Stack Auth.

All the logic required for generic usage of the config format are in `format/`. The other files in this folder are specific to Stack Auth's usage of it.

## Terminology

**Generic config format**:
- Config: Any config, as described in stack-info
- Normalized config: A config without `null` fields and dot notation

**Stack Auth**: There are four levels, project, branch, environment, organization.
- Base config: The defaults that come with Stack Auth
- `$Level` config override: Overrides that are applied to the base config (in the following order: project -> branch -> environment -> organization)
- `$Level` incomplete config: The base config after some overrides have been applied, deeply merged into `configDefaults`
- `$Level` rendered config: An incomplete config with those fields removed that can be overridden by a future override
- Complete config: The organization rendered config.

**Validation**: A config override can be both "schematically valid" and "sanity-check valid" (I would call it "semantically valid" but that word is so easily confused with "schematically"). The `validateXYZ` functions in `config.ts` check for the latter, while the yup schemas in `schema.ts` check for the former. The main difference is that whether an override is schematically valid depends only on the override itself; while its sanity-check validity depends on the base config that it overrides.

<details>
<summary>Examples</summary>

Base config:
```js
{
  organizations: {},
  createTeamOnSignUp: false,
  sourceOfTruthConnectionString: null
}
```

---

Project config override:
```js
{
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

Project incomplete config:
```js
// note: `organizations` and `createTeamOnSignUp` may be overridden by branch, environment, or organization configs! They are not final
{
  organizations: {},
  createTeamOnSignUp: false,
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

Project rendered config:
```js
// since `organizations` and `createTeamOnSignUp` may change later, they are not included in the rendered config
{
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

---

Branch config override:
```js
{
  organizations: {
    'my-org': {
      name: 'My Org',
    }
  }
}
```


Branch incomplete config:
```js
{
  organizations: {
    'my-org': {
      name: 'My Org',
    }
  },
  createTeamOnSignUp: true,
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

Branch rendered config:
```js
// as above, `organizations` and `createTeamOnSignUp` are not included in the rendered config, as they may change later
{
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

---

Environment config override:
```js
// no change from branch config
{}
```

Environment incomplete config:
```js
// no change from branch config
{
  organizations: {
    'my-org': {
      name: 'My Org',
    }
  },
  createTeamOnSignUp: true,
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

Environment rendered config:
```js
// organizations can no longer change after this point, so they are included in the rendered config
{
  organizations: {
    'my-org': {
      name: 'My Org',
    }
  },
  createTeamOnSignUp: true,
  sourceOfTruthConnectionString: 'postgresql://...',
}
```

---

Organization config override:
```js
{
  createTeamOnSignUp: true,
}
```

Organization incomplete config = organization rendered config = complete config:
```js
{
  createTeamOnSignUp: true,
  sourceOfTruthConnectionString: 'postgresql://...',
}
```


</details>
