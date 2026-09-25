---
description: How to release a new version of EdgeView Launcher
---

# Release Process

Auto-update depends on the release tag matching the version the app reports, and CI (`scripts/check-versions.js`) fails unless all four version fields agree. Only run this workflow when the user has explicitly asked for a release.

Run every command from the project root.

1. Bump the version on a release branch. Set the same `<VERSION>` in all four places: `package.json`, `frontend/package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
```bash
git checkout -b release/v<VERSION>
npm version <VERSION> --no-git-tag-version
npm --prefix frontend version <VERSION> --no-git-tag-version
# then edit src-tauri/tauri.conf.json and src-tauri/Cargo.toml by hand
(cd src-tauri && cargo check -q)   # refreshes the crate version in Cargo.lock
node scripts/check-versions.js
```

2. Commit, push the branch, and open a PR. `main` is protected; the bump lands through the PR like any other change.
```bash
git add package.json frontend/package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: bump version to v<VERSION>"
git push -u origin release/v<VERSION>
gh pr create --fill
```

3. After the PR is merged, create the release from the latest commit on `main`. The tag must match `v*`.
```bash
gh release create v<VERSION> --target main --generate-notes --title "v<VERSION>"
```

4. Verify the GitHub Action "Release" workflow succeeds and that the release has the installers (`.dmg`, `-setup.exe`, `.AppImage`) and `latest.json`, which the updater reads.
