# git-persona Specification

## Product Intent

`git-persona` is a Node.js CLI for switching Git identities, credentials, tokens, and SSH profiles without logging out or deleting existing credentials.

The primary user problem is that different Git accounts can have different repository permissions, signing keys, commit identities, and credential tokens. Switching should be fast, explicit, and reversible.

## Confirmed Decisions

### Runtime

- The CLI is implemented in Node.js.
- The installed command should support Git subcommand style usage:

```bash
git persona <command>
```

### Default Scope

- Persona switching applies to global Git configuration by default.
- Repo-local switching is available with a `--repo` option.
- Global switching changes the active credential for all `github.com` HTTPS remotes.
- Repo-local switching is responsible for repository-specific persona settings.

Examples:

```bash
git persona switch soyuo
git persona switch soyuo --repo
```

### Migration

`git persona migration` registers the currently active Git command account into git-persona.

It should detect the current Git environment and create a persona profile from it.

Detected values include:

- `user.name`
- `user.email`
- `user.signingkey`, when present
- `gpg.format`, when present
- `commit.gpgsign`, when present
- `credential.helper`
- current GitHub credential availability
- relevant SSH key paths, when detectable

The migration command should then let git-persona become the management layer for Git account switching.

Migration uses a preview/confirm flow before applying changes.

### Token Alias Model

- GitHub account IDs are used as user-facing aliases for token-backed personas.
- The user should choose a GitHub ID when switching token credentials.
- Token values must not be shown in ordinary list/current output.
- Token values should not be stored in plaintext profile files.
- HTTPS token auth is preferred when a persona has both HTTPS token auth and SSH auth.
- SSH auth is used as the fallback when HTTPS token auth is unavailable or fails.
- Persona-specific GitHub credentials use the GitHub username as the GCM account selector.
- `git persona run <git-command> [args...]` retries a GitHub HTTPS authentication failure once after rewriting GitHub HTTPS remotes to SSH.
- If the SSH retry fails, the CLI asks the user to run `git persona login <id>`.

Example selector:

```text
◉ soyuo
○ work-github-id
○ school-github-id
```

### Terminal UI

- The first GUI experience is terminal-based.
- Selected items use `◉`.
- Unselected items use `○`.

## Command Concepts

### Account State

```bash
git persona current
```

Shows the currently active Git identity and credential routing.

```bash
git persona list
```

Lists saved personas. Tokens are never printed.

### Switching

```bash
git persona switch <github-id>
git persona switch <github-id> --repo
```

Switches Git identity and token routing to the selected persona.

When no `<github-id>` is passed, the CLI may show the terminal selector.

```bash
git persona switch
```

Selector display:

```text
◉ soyuo
○ work-github-id
○ school-github-id
```

### Migration

```bash
git persona migration
git persona migration --name soyuo
git persona migration --dry-run
git persona migration --repo
```

Creates a git-persona profile from the current Git command environment.

### Profile Management

```bash
git persona add <github-id>
git persona edit <github-id>
git persona remove <github-id>
```

Manages persona metadata.

### Credential Management

```bash
git persona login <github-id>
git persona logout <github-id>
git persona credentials
```

`login` stores or connects a token credential for the persona.

`logout` removes only the credential associated with the selected persona.

`credentials` lists credential targets and status without printing token values.

### Repository Binding

```bash
git persona repo bind <github-id>
git persona repo unbind
```

Binds or unbinds the current repository to a persona.

```bash
git persona run <git-command> [args...]
```

Runs a Git command, switching GitHub HTTPS remotes to SSH and retrying once
when HTTPS authentication fails.

### Diagnostics

```bash
git persona doctor
```

Checks Git config, credential manager status, SSH/signing settings, remote URL compatibility, and persona consistency.

## Open Questions

These decisions remain for later implementation.

1. How should SSH key availability and signing-key validity be diagnosed by `doctor`?
