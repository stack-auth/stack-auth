# Some notes on configs

The language in this file is very technical, if you're struggling, put it into ChatGPT and see if it can help you (with the usual hallucination disclaimer).
 
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
- `$Level` incomplete config: The base config after some overrides have been applied
- `$Level` rendered config: An incomplete config with those fields removed that can be overridden by a future override, deeply merged into the defaults and sanitized (using `apply{$Level}DefaultsAndSanitize`), and then normalized
- Complete config: The organization rendered config.
- `$Level` config override override: An override that overrides the `$Level` config override. This is most often used eg. in the REST API to let users make changes to the branch-level config, without overwriting the entire branch-level config override. *<sup>Note that, since config overrides (unlike configs) distinguish between `null` and a property missing (`undefined`), it is currently not possible to say "this property in the config override should be unset" (setting a property to `null` in the override override will simply also set it to `null` in the override). In the future, we'll have to think about how we handle this, probably with a sentinel value.</sup>*
- `$Level` config: Could refer to any of the above, depending on the context; if it's not clear, specify it.

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
