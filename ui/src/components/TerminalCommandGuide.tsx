import { useEffect, useRef, useState } from 'react'
import { Chip, Panel } from './Panel'

interface CommandItem {
  id: string
  command: string
  description: string
  caution?: boolean
}

interface CommandCategory {
  id: string
  icon: string
  title: string
  description: string
  commands: CommandItem[]
}

const categories: CommandCategory[] = [
  {
    id: 'navigate', icon: '⌖', title: 'Navigate', description: 'See where you are and move around',
    commands: [
      { id: 'pwd', command: 'pwd', description: 'Show the current folder' },
      { id: 'list', command: 'ls -lah', description: 'List files, including hidden files and readable sizes' },
      { id: 'up', command: 'cd ..', description: 'Move up one folder' },
      { id: 'clear', command: 'clear', description: 'Clear the terminal screen' },
    ],
  },
  {
    id: 'files', icon: '▤', title: 'Files & folders', description: 'Create, copy, rename, and inspect files',
    commands: [
      { id: 'mkdir', command: 'mkdir -p new-folder', description: 'Create a folder' },
      { id: 'touch', command: 'touch new-file.txt', description: 'Create an empty file' },
      { id: 'copy', command: 'cp source.txt copy.txt', description: 'Copy a file' },
      { id: 'move', command: 'mv old-name.txt new-name.txt', description: 'Move or rename a file' },
      { id: 'remove', command: 'rm file-name.txt', description: 'Permanently delete a file', caution: true },
    ],
  },
  {
    id: 'search', icon: '⌕', title: 'Find & inspect', description: 'Search project names and contents',
    commands: [
      { id: 'rg-text', command: 'rg "search text" .', description: 'Search file contents' },
      { id: 'rg-files', command: 'rg --files', description: 'List searchable project files' },
      { id: 'find', command: 'find . -maxdepth 2 -type f', description: 'Find files up to two folders deep' },
      { id: 'head', command: 'head -n 20 file.txt', description: 'Show the first 20 lines of a file' },
      { id: 'tail', command: 'tail -f file.log', description: 'Watch new lines added to a log' },
    ],
  },
  {
    id: 'git', icon: '⑂', title: 'Git', description: 'Review and manage project changes',
    commands: [
      { id: 'git-status', command: 'git status --short', description: 'Show changed and untracked files' },
      { id: 'git-diff', command: 'git diff', description: 'Review unstaged changes' },
      { id: 'git-log', command: 'git log --oneline --decorate -10', description: 'Show the 10 latest commits' },
      { id: 'git-add', command: 'git add -p', description: 'Choose changes to stage interactively' },
      { id: 'git-unstage', command: 'git restore --staged file-name', description: 'Unstage a file without deleting changes' },
    ],
  },
  {
    id: 'node', icon: '⬡', title: 'Node projects', description: 'Run common package scripts',
    commands: [
      { id: 'npm-scripts', command: 'npm run', description: 'List scripts available in package.json' },
      { id: 'npm-test', command: 'npm test', description: 'Run the project tests' },
      { id: 'npm-build', command: 'npm run build', description: 'Create a production build' },
      { id: 'npm-dev', command: 'npm run dev', description: 'Start the development server' },
    ],
  },
  {
    id: 'system', icon: '◫', title: 'Processes & space', description: 'Inspect running work and storage',
    commands: [
      { id: 'processes', command: 'ps aux', description: 'List running processes' },
      { id: 'jobs', command: 'jobs -l', description: 'List jobs started by this shell' },
      { id: 'disk-folder', command: 'du -sh ./*', description: 'Show the size of items in this folder' },
      { id: 'disk', command: 'df -h', description: 'Show available filesystem space' },
      { id: 'memory', command: 'free -h', description: 'Show available container memory' },
    ],
  },
]

function fallbackCopy(command: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = command
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

export function TerminalCommandGuide() {
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState(false)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  async function copy(command: CommandItem) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(command.command)
      else if (!fallbackCopy(command.command)) throw new Error('Copy unavailable')
      setCopied(command.id)
      setCopyError(false)
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(''), 1_800)
    } catch {
      setCopied('')
      setCopyError(true)
    }
  }

  return (
    <Panel eyebrow="Terminal companion" title="Linux command deck" action={<Chip tone="accent">click to copy</Chip>} fullWidth className="command-guide">
      <div className="command-guide__intro">
        <div><strong>Quick commands, ready when you need them.</strong><span>Open a category, copy a command, then paste it into the terminal. Replace example names before running.</span></div>
        <span className="command-guide__shortcut">Paste: Ctrl+Shift+V <small>or ⌘V on Mac</small></span>
      </div>
      {copyError && <div className="connection-banner" role="alert">Your browser blocked clipboard access. Select the command text and copy it manually.</div>}
      <div className="command-guide__grid">
        {categories.map((category, index) => (
          <details className="command-category" key={category.id} open={index === 0}>
            <summary>
              <span className="command-category__icon" aria-hidden="true">{category.icon}</span>
              <span><strong>{category.title}</strong><small>{category.description}</small></span>
              <span className="command-category__count">{category.commands.length}</span>
              <span className="command-category__chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="command-category__items">
              {category.commands.map((command) => (
                <button className={`command-card${command.caution ? ' command-card--caution' : ''}`} type="button" key={command.id} onClick={() => void copy(command)} title={`Copy: ${command.command}`}>
                  <span className="command-card__details"><code>{command.command}</code><small>{command.description}</small></span>
                  <span className={`command-card__copy${copied === command.id ? ' is-copied' : ''}`}>{copied === command.id ? 'Copied!' : 'Copy'}</span>
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">{copied ? 'Command copied to clipboard' : ''}</span>
    </Panel>
  )
}
