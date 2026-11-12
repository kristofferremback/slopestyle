# GitHub Actions platform reference

Public platform context retrieved 2026-11-12 for offline review. These are documentation facts, not evidence that a particular repository or hosted run behaved correctly. Check the cited current documentation when network access is available; historical replays retain this snapshot and its retrieval date.

## Workflow events

`pull_request` supports separate activity types, including assigned/unassigned, labels, opened, edited, closed/reopened, synchronize, draft/ready, locks, review requests, milestones, auto-merge and merge-queue entry/exit. Without a `types` filter the defaults are opened, synchronize and reopened. Explicit `types` select the activities that schedule a workflow. Branch and path filters must both match when both are configured. The event normally checks out a test merge ref; the head commit is separately available as `pull_request.head.sha`. Fork permissions and secrets differ, and merge-conflicted PRs do not run normal `pull_request` workflows. [GitHub: workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

The `pull_request` edited-event schema includes previous title, body, and base reference/SHA fields under `changes`. It is a different activity from synchronize. The schema establishes a representation, not an exhaustive live event sequence. [Octokit: edited-event schema](https://raw.githubusercontent.com/octokit/webhooks/main/payload-schemas/api.github.com/pull_request/edited.schema.json).

## Check evaluation

Required checks are evaluated for the latest relevant commit. Success, skipped and neutral can satisfy required status checks. When a test merge commit has a status, that commit must pass; otherwise evaluation can use the head commit. A job skipped by its conditional reports success. A workflow omitted by path/branch filtering can leave required checks pending. Dependent jobs skipped after a failure need careful aggregate handling. [GitHub: required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

## Native stacks

Workflows and branch rules are evaluated against the stack base. Stack metadata exists only for a member PR. Its fields include number, size, 1-based position, and base ref/SHA. Position 1 is the original bottom; the lowest unmerged PR can instead be recognized by its direct base equaling the stack base. The top position equals size. Lower merges can change which remaining PR is lowest; the documentation describes the new classification on a following workflow run, not a complete event-delivery guarantee. [GitHub: stack CI](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/optimizing-ci-for-stacked-pull-requests).
