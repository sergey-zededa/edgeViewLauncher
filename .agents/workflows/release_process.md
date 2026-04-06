---
description: How to release a new version of EdgeView Launcher
---

# Release Process

When preparing a new release, follow these steps strictly to ensure auto-update compatibility:

1. Ensure you are in the project root directory
```bash
// turbo
pwd
```

2. Bump Versions in package.json and frontend/package.json
```bash
// turbo
npm version patch --no-git-tag-version && cd frontend && npm version patch --no-git-tag-version && cd ..
```

3. Stage and Commit Changes
```bash
// turbo
git add package.json frontend/package.json
```

```bash
// turbo
git commit -m "chore: bump version"
```

```bash
// turbo
git push origin main
```

4. Trigger Release Build on GitHub
Provide the tag matching the `v*` pattern from the latest commit.

```bash
// turbo
gh release create v<VERSION> --generate-notes --title "v<VERSION>"
```

5. Verify GitHub Action "Release" workflow runs successfully.
Ensure artifacts are generated correctly.
