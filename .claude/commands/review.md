Run a multi-perspective review on a pull request for Dorky Robot GitHub Page.

## Step 1: Fetch the PR diff

```bash
gh pr diff $ARGUMENTS --repo $(gh repo view --json nameWithOwner --jq .nameWithOwner)
```

Also fetch the PR description for context:

```bash
gh pr view $ARGUMENTS --json title,body
```

## Step 2: Launch 4 review agents in parallel

Send a **single message** with 4 Task tool calls so they run concurrently. Each agent receives:

```
You are reviewing PR #<N> for the Dorky Robot GitHub Page (a static HTML+CSS site hosted on GitHub Pages).

<pr-description>
<the PR title and body>
</pr-description>

<diff>
<the full diff output>
</diff>
```

The 4 agents:

1. **Security reviewer** (`security-reviewer` agent) — Scan the diff for XSS vectors, unsafe link targets, `javascript:` protocol links, mixed content, missing `rel="noopener"`, and content injection risks.

2. **Correctness reviewer** (`correctness-reviewer` agent) — Check for broken links (especially GitHub repo URLs), invalid HTML, missing `alt` attributes, CSS selector mismatches, and responsive layout breakage.

3. **Design reviewer** (`design-reviewer` agent) — Evaluate adherence to the design system: CSS custom property usage, card structure patterns, language badge conventions, typography scale, and dark theme consistency.

4. **Performance reviewer** (`performance-reviewer` agent) — Check for page weight increases, unoptimized images, render-blocking resources, and layout shift risks.

Each agent must end its response with exactly one verdict line:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NOTES
VERDICT: REQUEST_CHANGES
```

## Step 3: Synthesize verdicts

Combine all 4 agent responses into a single review summary:

```
## Review Summary for PR #<N>

### Security
<verdict> — <key findings or "No issues">

### Correctness
<verdict> — <key findings or "No issues">

### Design
<verdict> — <key findings or "No issues">

### Performance
<verdict> — <key findings or "No issues">

### Overall
<APPROVE / APPROVE_WITH_NOTES / REQUEST_CHANGES>
<1-2 sentence summary>
```

## Step 4: Post as PR comment

```bash
gh pr comment $ARGUMENTS --body "<the review summary>"
```
