const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const GIT_EXEC_OPTS = { cwd: __dirname, timeout: 5000, maxBuffer: 1024 * 1024 };

// Simple in-memory rate limiter: max 10 requests per IP per minute
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function gitStatusRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return next();
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests', suggestions: [] });
  }
  entry.count++;
  return next();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Sections that are not tool lists (skip them)
const NON_LIST_SECTIONS = new Set(['Guides', 'Other Awesome Lists', 'See also']);

function parseReadme() {
  let content;
  try {
    content = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  } catch (err) {
    console.error('Failed to read README.md:', err.message);
    return [];
  }

  const categories = [];
  let currentCategory = null;
  let currentSubcategory = null;

  const lines = content.split('\n');

  for (const line of lines) {
    // Match H2 headings as categories
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      const name = h2Match[1].trim();
      if (NON_LIST_SECTIONS.has(name)) {
        currentCategory = null;
        currentSubcategory = null;
      } else {
        currentCategory = { name, items: [], subcategories: [] };
        categories.push(currentCategory);
        currentSubcategory = null;
      }
      continue;
    }

    // Match H3 headings as subcategories
    const h3Match = line.match(/^### (.+)/);
    if (h3Match && currentCategory) {
      currentSubcategory = { name: h3Match[1].trim(), items: [] };
      currentCategory.subcategories.push(currentSubcategory);
      continue;
    }

    // Match list items (both * and - prefixes)
    const itemMatch = line.match(/^[*\-] \[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/);
    if (itemMatch && currentCategory) {
      const item = {
        name: itemMatch[1].trim(),
        url: itemMatch[2].trim(),
        description: itemMatch[3].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      };
      if (currentSubcategory) {
        currentSubcategory.items.push(item);
      } else {
        currentCategory.items.push(item);
      }
    }
  }

  return categories;
}

const categories = parseReadme();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => {
  res.json(categories);
});

app.get('/api/git-status', gitStatusRateLimit, (req, res) => {
  Promise.all([
    execAsync('git status --porcelain=v1', GIT_EXEC_OPTS).then(r => r.stdout).catch(() => ''),
    execAsync('git branch --show-current', GIT_EXEC_OPTS).then(r => r.stdout.trim()).catch(() => ''),
    execAsync('git rev-list --left-right --count HEAD...@{upstream}', GIT_EXEC_OPTS).then(r => r.stdout.trim()).catch(() => '0\t0')
  ]).then(([porcelain, branch, aheadBehindRaw]) => {
    const lines = porcelain.split('\n').filter(Boolean);
    const staged = lines.filter(l => l[0] !== ' ' && l[0] !== '?' && l[0] !== '!');
    const unstaged = lines.filter(l => l[1] === 'M' || l[1] === 'D');
    const untracked = lines.filter(l => l.startsWith('??'));
    const [aheadStr, behindStr] = aheadBehindRaw.split('\t');
    const ahead = parseInt(aheadStr, 10) || 0;
    const behind = parseInt(behindStr, 10) || 0;

    const suggestions = [];

    if (behind > 0) {
      suggestions.push({ type: 'warning', message: `Your branch is ${behind} commit(s) behind the remote. Run: git pull` });
    }
    if (untracked.length > 0) {
      suggestions.push({ type: 'info', message: `${untracked.length} untracked file(s). Run: git add <file> to start tracking them.` });
    }
    if (unstaged.length > 0) {
      suggestions.push({ type: 'info', message: `${unstaged.length} modified file(s) not yet staged. Run: git add -p to stage changes interactively.` });
    }
    if (staged.length > 0) {
      suggestions.push({ type: 'action', message: `${staged.length} change(s) staged and ready to commit. Run: git commit -m "your message"` });
    }
    if (ahead > 0) {
      suggestions.push({ type: 'action', message: `Your branch is ${ahead} commit(s) ahead of the remote. Run: git push to share your work.` });
    }
    if (lines.length === 0 && ahead === 0 && behind === 0) {
      suggestions.push({ type: 'success', message: 'Working tree is clean and up to date with the remote. Nothing to do!' });
    }

    res.json({
      branch,
      staged: staged.map(l => l.slice(3)),
      unstaged: unstaged.map(l => l.slice(3)),
      untracked: untracked.map(l => l.slice(3)),
      ahead,
      behind,
      clean: lines.length === 0,
      suggestions
    });
  }).catch(() => {
    res.json({ error: 'git status unavailable', suggestions: [] });
  });
});

app.listen(PORT, () => {
  console.log(`Awesome Shell app running on port ${PORT}`);
});
