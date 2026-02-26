Add a new project card to the Dorky Robot GitHub Page.

$ARGUMENTS should be the GitHub repo name under Dorky-Robot (e.g., "my-new-project") and optionally the language and description.

## Step 1: Gather project info

If $ARGUMENTS only contains a repo name, fetch details from GitHub:

```bash
gh repo view Dorky-Robot/$ARGUMENTS --json name,description,primaryLanguage
```

Determine:
- **Repo name**: from GitHub or $ARGUMENTS
- **Language**: from GitHub's `primaryLanguage` field
- **Description**: from GitHub's `description` field or $ARGUMENTS

## Step 2: Check for existing card

Read `index.html` and verify the project isn't already listed.

## Step 3: Determine card type

- If a logo image is provided or exists (e.g., `<name>.webp`), use the `.card-with-logo` variant
- Otherwise, use the standard `.card` variant

## Step 4: Map the language

Map the primary language to an existing CSS class:
- Rust → `lang rust`
- JavaScript → `lang js`
- TypeScript → `lang ts`
- Elixir → `lang elixir`

If the language doesn't have a CSS class yet, add one following the existing pattern:
1. Add `--<language>: <color>` to `:root` in `style.css`
2. Add `.lang.<language>` rule with `rgba(color, 0.15)` background

## Step 5: Add the card

Insert the new card HTML inside the `.grid` div in `index.html`, following the exact structure of existing cards:

**Standard card:**
```html
<a href="https://github.com/Dorky-Robot/<name>" class="card">
  <div class="card-header">
    <h3><name></h3>
    <span class="lang <language>"><Language></span>
  </div>
  <p><description></p>
</a>
```

**Card with logo:**
```html
<a href="https://github.com/Dorky-Robot/<name>" class="card card-with-logo">
  <img src="<name>.webp" alt="<name> logo" class="card-logo">
  <div class="card-body">
    <div class="card-header">
      <h3><name></h3>
      <span class="lang <language>"><Language></span>
    </div>
    <p><description></p>
  </div>
</a>
```

## Step 6: Verify

Read back the modified `index.html` to confirm the card was inserted correctly and the HTML is well-formed.
