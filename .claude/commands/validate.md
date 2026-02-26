Validate the Dorky Robot GitHub Page for correctness, accessibility, and broken links.

## Step 1: Read current files

Read `index.html` and `style.css` to understand the current state.

## Step 2: HTML validation

Check the HTML for:
- Proper document structure (`<!DOCTYPE>`, `<html lang>`, `<head>`, `<body>`)
- All tags properly closed and nested
- No duplicate `id` attributes
- All `<img>` tags have `alt` attributes
- All `<a>` tags have valid `href` attributes
- Semantic element usage (`<header>`, `<main>`, `<footer>`, `<section>`)
- Heading hierarchy (h1 > h2 > h3, no skipped levels)

## Step 3: Link validation

For every `<a href="...">` in the page:

```bash
gh repo view Dorky-Robot/<repo-name> --json name 2>/dev/null
```

Report any repositories that don't exist or have been renamed.

## Step 4: Asset validation

For every `<img src="...">`:
- Verify the file exists in the repository
- Check file size (warn if over 100KB)

```bash
ls -la *.webp *.png *.jpg *.svg 2>/dev/null
```

## Step 5: CSS validation

Check `style.css` for:
- All CSS custom properties defined before use
- All selectors match elements in the HTML
- No orphaned styles
- Consistent use of units (rem for spacing, px only for borders)
- Media queries properly ordered

## Step 6: Accessibility check

- Color contrast: verify `--text` on `--bg` and `--text-muted` on `--bg` meet WCAG AA
- Interactive element sizing: links should be tappable (adequate padding)
- Focus styles: are there visible focus indicators for keyboard navigation?

## Step 7: Report

```
## Validation Report for Dorky Robot GitHub Page

### HTML: <PASS/FAIL>
<findings>

### Links: <PASS/FAIL>
<findings — list any broken links>

### Assets: <PASS/FAIL>
<findings — list any missing or oversized assets>

### CSS: <PASS/FAIL>
<findings>

### Accessibility: <PASS/FAIL>
<findings>

### Summary
<overall status and recommended fixes>
```
