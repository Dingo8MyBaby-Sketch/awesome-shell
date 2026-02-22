const express = require('express');
const fs = require('fs');
const path = require('path');

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

app.listen(PORT, () => {
  console.log(`Awesome Shell app running on port ${PORT}`);
});
