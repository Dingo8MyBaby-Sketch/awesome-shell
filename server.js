const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let cachedData = null;

function parseReadme() {
  const content = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const lines = content.split('\n');
  const categories = [];
  let currentCategory = null;
  let currentSubCategory = null;

  // Matches: * [name](url) - description  OR  - [name](url) - description
  const itemRegex = /^[*-]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-—]?\s*(.*)/;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const name = line.replace(/^## /, '').trim();
      currentCategory = { name, items: [] };
      currentSubCategory = null;
      categories.push(currentCategory);
    } else if (line.startsWith('### ')) {
      const name = line.replace(/^### /, '').trim();
      if (currentCategory) {
        if (!currentCategory.subCategories) {
          currentCategory.subCategories = [];
        }
        currentSubCategory = { name, items: [] };
        currentCategory.subCategories.push(currentSubCategory);
      }
    } else {
      const match = line.match(itemRegex);
      if (match) {
        const item = {
          name: match[1].trim(),
          url: match[2].trim(),
          description: match[3].trim(),
        };
        if (currentSubCategory) {
          currentSubCategory.items.push(item);
        } else if (currentCategory) {
          currentCategory.items.push(item);
        }
      }
    }
  }

  return categories;
}

app.get('/api/data', (req, res) => {
  try {
    if (!cachedData) {
      cachedData = parseReadme();
    }
    res.json(cachedData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse README.md' });
  }
});

app.listen(PORT, () => {
  console.log(`Awesome Shell browser running at http://localhost:${PORT}`);
});
