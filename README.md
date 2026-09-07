# git-persona

Switch Git identities and GitHub credentials without logging out.

[English](README.md) [한국어](README-kor.md)

## Requirements

- Node.js 20 or later
- Git
- Git Credential Manager for `login`, `logout`, and `credentials`
- An SSH key configured with GitHub for SSH fallback

## Installation

Register this repository's CLI binary in the global npm PATH:

```bash
npm link
```

Then verify that the command is available:

```bash
git-persona --help
git persona --help
```

`npm link` creates a global link to this working copy, so changes made here are immediately reflected when the CLI runs. To remove the link later:

```bash
npm unlink --global git-persona
```

You can also run the CLI directly from this repository without linking:

```bash
npm start -- --help
```

The package exposes the `git-persona` binary. Git subcommand-style usage is also supported when the binary is installed on your PATH:

```bash
git persona <command>
```

Configuration is stored at `~/.git-persona/config.json`.

## Language

The CLI supports English (`en-US`) and Korean (`ko-KR`). Check the current language:

```bash
git persona lang
```

Set the global language for all repositories:

```bash
git persona lang ko-KR
git persona lang en-US
```

Set a language only for the current repository:

```bash
git persona lang ko-KR --repo
```

The repository-specific language takes precedence over the global language in that repository. Other repositories continue to use the global setting.

## Migration

Preview the current Git identity without changing files:

```bash
git persona migration --dry-run
```

Save the detected identity as a persona after confirmation:

```bash
git persona migration
git persona migration --name work
```

Use `--repo` to read the repository-local Git identity and bind the saved persona to the current repository.

## Profile management

Create, update, list, and remove personas with options:

```bash
git persona add work --name "Work User" --email work@example.com --signing-key ~/.ssh/id_ed25519.pub --gpg-format ssh --commit-gpg-sign true --credential-helper manager
git persona edit work --email updated@example.com
git persona list
git persona remove work
```

An active persona or repo-bound persona cannot be removed. Switch to another persona and retry.

## Switching personas

Switch the global Git identity and GitHub account selector:

```bash
git persona switch work
```

Switch only the current repository:

```bash
git persona switch work --repo
```

When no ID is supplied, an interactive selector opens:

```bash
git persona switch
```

Repository bindings can be managed explicitly:

```bash
git persona repo bind work
git persona repo unbind
```

`--repo` changes local Git configuration only. Global switching changes the user-level Git configuration.

## Credentials and token security

Login stores the token through Git Credential Manager using hidden terminal input:

```bash
git persona login work
git persona logout work
git persona credentials
```

To open Git Credential Manager's GitHub login flow directly:

```bash
git credential-manager github login
```

After completing the GCM login flow, verify the registered accounts:

```bash
git credential-manager github list
```

If an account is already registered in Git Credential Manager, register the same GitHub ID as a persona before switching to it:

```bash
git persona add soyuo2
git persona switch soyuo2
```

Check whether the persona's GitHub credential is available in GCM:

```bash
git persona credentials
```

If the credential is not available yet, add it through the hidden token prompt:

```bash
git persona login soyuo2
```

Tokens are never stored in `config.json`, shown in ordinary output, or accepted as command-line arguments. `credentials` reports only whether a matching GitHub account is present in GCM.

Persona switching selects the GitHub account with `credential.https://github.com.username`. The token itself remains in the operating system credential store managed by GCM.

## HTTPS and SSH fallback

Run Git operations through the wrapper when you want automatic fallback behavior:

```bash
git persona run fetch origin
git persona run push origin main
```

If a GitHub HTTPS authentication failure is detected, GitHub HTTPS remotes are rewritten to SSH and the command is retried once. If SSH also fails, the CLI asks you to authenticate with `git persona login <id>`.

The fallback applies to commands run through `git persona run`; ordinary direct `git` commands are not intercepted.

## Diagnostics

Run the read-only diagnostic command:

```bash
git persona current
git persona check
```

`check` checks Git, GCM, active persona consistency, credential presence, SSH availability, signing-key configuration, and repository remotes. Warnings do not produce a failing exit code; failures do.

## Development

```bash
npm test
npm run check
```

Tests use temporary repositories and isolated Git configuration files so they do not modify the user's global Git settings.
