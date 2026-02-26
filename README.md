# remove-safe-to-test-label

<a href="https://codecov.io/gh/nilsreichardt/remove-safe-to-test-label"><img src="https://codecov.io/gh/nilsreichardt/remove-safe-to-test-label/branch/main/graph/badge.svg" alt="codecov"></a>

A GitHub Action to automatically remove the `safe to test` label from a Pull Request when new code is pushed.

This is the "Reset" half of the Label Gate ([verify-safe-to-test-label](https://github.com/nilsreichardt/verify-safe-to-test-label)) security pattern. It ensures that every single commit from a fork is reviewed by a maintainer before sensitive CI/CD tasks are executed.

## Why do you need this?

If you use a "safe to test" label to gate your `pull_request_target` workflows, you are vulnerable to a **"Bait & Switch"** attack:

1.  **The Bait:** An attacker submits a perfectly safe PR.
2.  **The Hook:** A maintainer reviews the code and adds the `safe to test` label.
3.  **The Switch:** The attacker immediately pushes a new commit containing malicious code (e.g., a secret-stealing script).
4.  **The Exploit:** Because the label is still there, your CI runs automatically on the **malicious** code, exposing your secrets.

**This action prevents that.** It instantly strips the label the moment a new commit is detected, "locking" the CI until a maintainer re-approves the changes.

## Usage

This action should be placed at the very beginning of your workflow to ensure the "gate" is closed before any other checks occur.

```yaml
on:
  pull_request_target:
    types: [opened, synchronize, reopened, labeled]

jobs:
  gatekeeper:
    runs-on: ubuntu-latest
    permissions:
      # Required: To remove the label via the GitHub API
      contents: read
      pull-requests: write
    steps:
      - name: Reset Safety Status
        uses: nilsreichardt/remove-safe-to-test-label@v1
```

---

## Inputs

| Name         | Description                                                     | Default        |
| ------------ | --------------------------------------------------------------- | -------------- |
| `label`      | The label to remove when a new commit is pushed                 | `safe to test` |
| `repo-token` | Token used to remove the label. Requires `pull-requests: write` | `github.token` |

## How it works with the "Label Gate"

To fully secure your pipeline, you should use this action alongside **[verify-safe-to-test-label](https://github.com/nilsreichardt/verify-safe-to-test-label)**.

1.  **`remove-safe-to-test-label`** runs first. If the event is `synchronize` (a new push), it deletes the label.
2.  **`verify-safe-to-test-label`** runs second. It checks if the label exists.
3.  If the label was just removed (or was never there), the workflow fails safely before secrets are exposed.

### Example Integration

```yaml
steps:
  - name: Reset Gate
    uses: nilsreichardt/remove-safe-to-test-label@v1

  - name: Verify Gate
    uses: nilsreichardt/verify-safe-to-test-label@v1

  # Secrets are only reached if the steps above pass
  - name: Run Tests
    run: npm test
    env:
      SECRET_KEY: ${{ secrets.SENSITIVE_DATA }}
```

---

## Security Note

This action only removes labels on Pull Requests originating from **forks**. It will not interfere with internal PRs from members with write access to the repository, as those are already trusted.
