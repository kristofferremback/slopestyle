import { expect, test } from "bun:test";
import { enrichGithub } from "../scripts/lib/work/github-facts.ts";
import type { GithubRecord } from "../scripts/lib/work/github.ts";
const head = "a".repeat(40),
  other = "b".repeat(40);
const at = "2026-10-20T10:00:00Z";
function row() {
  return {
    key: "org/repo#1",
    data: {
      kind: "pr",
      title: "Example",
      url: "https://github.com/org/repo/pull/1",
      repository: "org/repo",
      number: 1,
      owned: true,
      requested: false,
      hidden: false,
      draft: false,
      status: "approved",
      head: "aaa",
      expectedHead: head,
      threadUrl: "",
    } as GithubRecord,
  };
}
function payload() {
  return {
    data: {
      viewer: { login: "human" },
      p0: {
        pullRequest: {
          number: 1,
          repository: { nameWithOwner: "org/repo" },
          author: { login: "someone" },
          headRefOid: head,
          state: "OPEN",
          isDraft: false,
          baseRefName: "main",
          headRefName: "change",
          headRepository: { nameWithOwner: "fork/repo" },
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviewDecision: "APPROVED",
          commits: {
            nodes: [
              {
                commit: {
                  oid: head,
                  statusCheckRollup: {
                    contexts: {
                      nodes: [
                        {
                          __typename: "CheckRun",
                          name: "test",
                          status: "COMPLETED",
                          conclusion: "FAILURE",
                        },
                      ],
                      pageInfo: { hasNextPage: false },
                    },
                  },
                },
              },
            ],
          },
          reviews: {
            nodes: [
              {
                author: { login: "human" },
                state: "CHANGES_REQUESTED",
                submittedAt: at,
                commit: { oid: other },
              },
            ],
            pageInfo: { hasPreviousPage: false },
          },
        },
      },
    },
  };
}
test("should read one bounded factual batch and preserve unchanged evidence timestamps", async () => {
  const r = row();
  const command = async (args: string[]) => {
    expect(args.slice(0, 4)).toEqual([
      "api",
      "graphql",
      "--hostname",
      "github.com",
    ]);
    expect(args[5]).toStartWith("query=query {");
    expect(args[5]).not.toContain("mutation");
    return payload();
  };
  expect(await enrichGithub([r], new Map(), at, command)).toBe(false);
  expect(r.data.facts).toMatchObject({
    headOid: head,
    viewer: "human",
    author: "someone",
    checksComplete: true,
    reviewsComplete: true,
    ownReview: { state: "CHANGES_REQUESTED", commitOid: other },
    checks: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }],
  });
  const next = row();
  await enrichGithub(
    [next],
    new Map([[r.key, r.data]]),
    "2026-10-20T11:00:00Z",
    command,
  );
  expect(next).toEqual(r);
});
test("should retain legacy records and prior facts on missing partial or failed reads", async () => {
  const old = row();
  await enrichGithub([old], new Map(), at, async () => payload());
  for (const command of [
    async () => ({}),
    async () => ({
      data: { viewer: { login: "human" }, p0: null },
      errors: [{}],
    }),
    async () => {
      throw new Error("rate limit secret detail");
    },
  ]) {
    const r = row();
    expect(
      await enrichGithub([r], new Map([[r.key, old.data]]), "later", command),
    ).toBe(true);
    expect(r.data.facts).toEqual(old.data.facts);
    expect(r.data.factsGap).toContain("stale");
    expect(JSON.stringify(r)).not.toContain("secret");
    const legacy = row();
    await enrichGithub([legacy], new Map(), at, command);
    expect(legacy.data.facts).toBeUndefined();
  }
});
test("should reject wrong PR identity and detach checks from the wrong head", async () => {
  const p = payload();
  p.data.p0.pullRequest.number = 2;
  const r = row();
  await enrichGithub([r], new Map(), at, async () => p);
  expect(r.data.facts).toBeUndefined();
  p.data.p0.pullRequest.number = 1;
  p.data.p0.pullRequest.commits.nodes[0]!.commit.oid = other;
  await enrichGithub([r], new Map(), at, async () => p);
  expect(r.data.facts?.checks).toEqual([]);
  expect(r.data.facts?.checksComplete).toBe(false);
});
test("should expose closed changed heads incomplete connections and viewer identity without trusting watcher approval", async () => {
  const p = payload(),
    pr = p.data.p0.pullRequest;
  pr.state = "CLOSED";
  pr.headRefOid = other;
  pr.commits.nodes[0]!.commit.oid = other;
  pr.commits.nodes[0]!.commit.statusCheckRollup.contexts.pageInfo.hasNextPage = true;
  pr.reviews.pageInfo.hasPreviousPage = true;
  p.data.viewer.login = "different";
  const r = row();
  expect(await enrichGithub([r], new Map(), at, async () => p)).toBe(true);
  expect(r.data.facts).toMatchObject({
    state: "CLOSED",
    headOid: other,
    viewer: "different",
    ownReview: null,
    checksComplete: false,
    reviewsComplete: false,
  });
});

test("should use unaffected aliases from partial GraphQL results and bound candidates", async () => {
  const first = row(),
    second = row();
  second.key = "org/repo#2";
  second.data.number = 2;
  const p = { ...payload(), errors: [{ path: ["p1"], type: "NOT_FOUND" }] };
  expect(
    await enrichGithub([first, second], new Map(), at, async () => p),
  ).toBe(true);
  expect(first.data.facts?.headOid).toBe(head);
  expect(second.data.facts).toBeUndefined();
  const rows = Array.from({ length: 41 }, (_, i) => {
    const r = row();
    r.key = `org/repo#${i + 1}`;
    r.data.number = i + 1;
    return r;
  });
  let calls = 0;
  await enrichGithub(rows, new Map(), at, async (args) => {
    calls++;
    expect(args[5]).toContain("p39:");
    expect(args[5]).not.toContain("p40:");
    return payload();
  });
  expect(calls).toBe(1);
  expect(rows[40]!.data.factsGap).toContain("unavailable");
});

test("should mark malformed connections incomplete and ignore comments as decisive reviews", async () => {
  const p = payload(),
    pr = p.data.p0.pullRequest;
  // The API boundary accepts unknown input; keep the complete fixture strongly typed.
  const malformed: unknown = { contexts: {} };
  Object.assign(pr.commits.nodes[0]!.commit, { statusCheckRollup: malformed });
  pr.reviews.nodes.push({
    author: { login: "human" },
    state: "COMMENTED",
    submittedAt: "2026-10-21T10:00:00Z",
    commit: { oid: head },
  });
  const r = row();
  expect(await enrichGithub([r], new Map(), at, async () => p)).toBe(true);
  expect(r.data.facts?.checksComplete).toBe(false);
  expect(r.data.facts?.ownReview?.state).toBe("CHANGES_REQUESTED");
  expect(r.data.factsGap).toContain("coverage incomplete");
});

test("should not represent watcher expected-head disagreement as gap-free evidence", async () => {
  const r = row();
  r.data.expectedHead = other;
  expect(await enrichGithub([r], new Map(), at, async () => payload())).toBe(true);
  expect(r.data.facts?.headOid).toBe(head);
  expect(r.data.factsGap).toContain("head differs");
  r.data.expectedHead = head;
  expect(await enrichGithub([r], new Map(), "later", async () => payload())).toBe(
    false,
  );
  expect(r.data.factsGap).toBeUndefined();
});
