'use strict'

// Custom conventional-changelog preset for LumenFlow.
// Groups: Features, Bug Fixes, Security, Performance, Breaking Changes.
// Covers all types required by acceptance criteria (#611).

module.exports = {
  writerOpts: {
    // Entries under these commit types are included in the changelog.
    // "security" and "perf" are added on top of the angular defaults.
    transform: (commit, context) => {
      const issues = []

      // Map type → section title
      const TYPE_MAP = {
        feat: '🚀 Features',
        fix: '🐛 Bug Fixes',
        security: '🔒 Security',
        perf: '⚡ Performance',
        revert: '⏪ Reverts',
        docs: '📝 Documentation',
        ci: '🤖 CI',
        build: '🔧 Build'
      }

      if (!TYPE_MAP[commit.type]) {
        return  // skip types not in our map
      }

      commit.type = TYPE_MAP[commit.type]

      // Detect BREAKING CHANGE notes and tag the entry
      if (commit.notes) {
        commit.notes.forEach(note => {
          if (note.title === 'BREAKING CHANGE') {
            note.title = '⚠ BREAKING CHANGES'
          }
          issues.push(note)
        })
      }

      // Shorten commit hash for display
      if (typeof commit.hash === 'string') {
        commit.shortHash = commit.hash.substring(0, 7)
      }

      // Turn issue references (#N) into links
      if (typeof commit.subject === 'string') {
        commit.subject = commit.subject.replace(/#([0-9]+)/g, (_, issue) => {
          issues.push(issue)
          if (!context.repository) return `#${issue}`
          return `[#${issue}](${context.host}/${context.owner}/${context.repository}/issues/${issue})`
        })
      }

      return commit
    },

    // Group changelog sections by the mapped type string above
    groupBy: 'type',

    // Sort: breaking first, then features, fixes, security, perf, the rest
    commitGroupsSort: (a, b) => {
      const order = [
        '⚠ BREAKING CHANGES',
        '🚀 Features',
        '🐛 Bug Fixes',
        '🔒 Security',
        '⚡ Performance',
        '⏪ Reverts',
        '📝 Documentation',
        '🤖 CI',
        '🔧 Build'
      ]
      return order.indexOf(a.title) - order.indexOf(b.title)
    },

    commitsSort: ['scope', 'subject']
  }
}
