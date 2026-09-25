// changelog.config.js
// Enforces Keep a Changelog (https://keepachangelog.com/en/1.1.0/) format
// for automated changelog tooling (e.g. auto-changelog, conventional-changelog).

'use strict';

module.exports = {
  // Standard Keep a Changelog categories — only these are allowed.
  types: [
    { type: 'added',      section: 'Added',      hidden: false },
    { type: 'changed',    section: 'Changed',    hidden: false },
    { type: 'deprecated', section: 'Deprecated', hidden: false },
    { type: 'removed',    section: 'Removed',    hidden: false },
    { type: 'fixed',      section: 'Fixed',      hidden: false },
    { type: 'security',   section: 'Security',   hidden: false },
  ],

  // CHANGELOG.md is written to the repo root.
  outFile: 'CHANGELOG.md',

  // Prepend new entries above the existing content.
  append: false,

  // Require an [Unreleased] section at the top of every release.
  unreleased: true,

  // Commit URL template (replace with your actual repo if forked).
  commitUrlFormat:
    'https://github.com/Gloriachinedu/lumenflow-contracts/commit/{{hash}}',

  // Compare URL template used for version diff links.
  compareUrlFormat:
    'https://github.com/Gloriachinedu/lumenflow-contracts/compare/{{previousTag}}...{{currentTag}}',

  // Issue/PR URL template.
  issueUrlFormat:
    'https://github.com/Gloriachinedu/lumenflow-contracts/issues/{{id}}',

  // Use ISO 8601 date format (YYYY-MM-DD) as required by Keep a Changelog.
  releaseCommitMessageFormat: 'chore(release): {{currentTag}}',

  // Header inserted at the top of the CHANGELOG.
  header:
    '# Changelog\n\n' +
    'All notable changes to this project will be documented in this file.\n\n' +
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\n' +
    'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
};
