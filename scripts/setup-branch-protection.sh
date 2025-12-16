#!/bin/bash
# Setup branch protection for main branch after making repository public
# This script should be run AFTER making the repository public

set -e

echo "Setting up branch protection for main branch..."

gh api repos/sergey-zededa/edgeViewLauncher/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
EOF

echo "✓ Branch protection enabled for main branch"
echo ""
echo "Protection rules:"
echo "  - Require pull request with 1 approval before merging"
echo "  - Dismiss stale reviews when new commits are pushed"
echo "  - Require conversation resolution before merging"
echo "  - Prevent force pushes"
echo "  - Prevent branch deletion"
