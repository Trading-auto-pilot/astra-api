const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.DOCS_API_PORT || 3106);
const DOCS_ROOT = path.resolve(__dirname, 'docs', '06-roadmap');
const SIDEBAR_PATH = path.resolve(__dirname, 'sidebars.js');
const PARAGRAPHS_START_MARKER = '<!-- ROADMAP_PARAGRAPHS_START -->';
const PARAGRAPHS_END_MARKER = '<!-- ROADMAP_PARAGRAPHS_END -->';
const BUILD_TIMEOUT_MS = Number(process.env.DOCS_BUILD_TIMEOUT_MS || 300000);

let buildQueue = Promise.resolve();

app.use(express.json({ limit: '1mb' }));

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asSingleLine(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function extractTitleFromFrontMatter(markdownContent) {
  const match = markdownContent.match(/^---[\s\S]*?\btitle:\s*"([^"]+)"[\s\S]*?---/m);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function extractFirstH1(markdownContent) {
  const body = stripFrontMatter(markdownContent);
  const match = body.match(/^#\s+(.+?)\s*#*$/m);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function extractPageTitle(markdownContent, fallback) {
  return extractTitleFromFrontMatter(markdownContent) || extractFirstH1(markdownContent) || fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureRoadmapItemInSidebar(docId) {
  const sidebarContent = await fs.readFile(SIDEBAR_PATH, 'utf8');
  if (sidebarContent.includes(`'${docId}'`)) {
    return false;
  }

  const marker = "      items: [\n";
  const roadmapAnchor =
    "      label: '6. Roadmap',\n      link: {type: 'doc', id: 'roadmap/overview'},\n      items: [\n";
  const insertLine = `        '${docId}',\n`;

  const anchorIndex = sidebarContent.indexOf(roadmapAnchor);
  if (anchorIndex === -1) {
    throw new Error("Roadmap section not found in sidebars.js");
  }

  const itemsStartIndex = sidebarContent.indexOf(marker, anchorIndex);
  if (itemsStartIndex === -1) {
    throw new Error("Roadmap items array not found in sidebars.js");
  }

  const insertAt = itemsStartIndex + marker.length;
  const updated =
    sidebarContent.slice(0, insertAt) + insertLine + sidebarContent.slice(insertAt);

  await fs.writeFile(SIDEBAR_PATH, updated, 'utf8');
  return true;
}

async function removeRoadmapItemFromSidebar(docId) {
  const sidebarContent = await fs.readFile(SIDEBAR_PATH, 'utf8');
  const linePattern = new RegExp(`^\\s*'${escapeRegExp(docId)}',\\n?`, 'm');
  if (!linePattern.test(sidebarContent)) {
    return false;
  }

  const updated = sidebarContent.replace(linePattern, '');
  await fs.writeFile(SIDEBAR_PATH, updated, 'utf8');
  return true;
}

function stripFrontMatter(markdownContent) {
  return markdownContent.replace(/^---[\s\S]*?---\s*/m, '');
}

function splitFrontMatter(markdownContent) {
  const match = markdownContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/);
  if (!match) {
    return { frontMatter: '', body: markdownContent };
  }

  return {
    frontMatter: match[0],
    body: markdownContent.slice(match[0].length),
  };
}

function extractFrontMatterField(frontMatter, fieldName) {
  const escapedFieldName = escapeRegExp(fieldName);
  const match = frontMatter.match(new RegExp(`^${escapedFieldName}:\\s*"([^"]*)"$`, 'm'));
  if (!match || !match[1]) {
    return null;
  }
  return match[1].trim();
}

function headingAnchor(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseParagraphSections(markdownBlock) {
  const lines = String(markdownBlock || '').split(/\r?\n/);
  const sections = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^##\s+(.+?)\s*#*$/);
    if (!match || !match[1]) {
      continue;
    }

    sections.push({
      number: sections.length + 1,
      title: match[1].trim(),
      startLine: i,
    });
  }

  for (let i = 0; i < sections.length; i += 1) {
    sections[i].endLine = i + 1 < sections.length ? sections[i + 1].startLine : lines.length;
  }

  return {
    lines,
    sections,
  };
}

function parseManagedParagraphs(markdownContent) {
  const body = stripFrontMatter(markdownContent);
  const startIndex = body.indexOf(PARAGRAPHS_START_MARKER);
  const endIndex = body.indexOf(PARAGRAPHS_END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  const rawBlock = body
    .slice(startIndex + PARAGRAPHS_START_MARKER.length, endIndex)
    .replace(/^\s+|\s+$/g, '');
  const parsed = parseParagraphSections(rawBlock);

  return parsed.sections.map((section) => ({
    number: section.number,
    title: section.title,
    content: parsed.lines.slice(section.startLine + 1, section.endLine).join('\n').trim(),
  }));
}

function renderParagraphsBlock(paragraphs) {
  if (!paragraphs.length) {
    return '';
  }

  return `${paragraphs
    .map((paragraph) => `## ${paragraph.title}\n\n${paragraph.content.trim()}`)
    .join('\n\n')}\n\n`;
}

function renderNavigation(paragraphs) {
  if (!paragraphs.length) {
    return '_Ancora nessun paragrafo._';
  }

  return paragraphs
    .map((paragraph, index) => `${index + 1}. [${paragraph.title}](#${headingAnchor(paragraph.title)})`)
    .join('\n');
}

function renderRoadmapPage({ title, frontMatter, paragraphs }) {
  const navigation = renderNavigation(paragraphs);
  const paragraphsBlock = renderParagraphsBlock(paragraphs);

  return `${frontMatter}# ${title}\n\n## Navigazione\n\n${navigation}\n\n${PARAGRAPHS_START_MARKER}\n\n${paragraphsBlock}${PARAGRAPHS_END_MARKER}\n`;
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn('npm', ['run', 'build'], {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Docs build timed out after ${BUILD_TIMEOUT_MS}ms`));
    }, BUILD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 8000) stdout = stdout.slice(-8000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ durationMs: Date.now() - startedAt });
        return;
      }

      const details = (stderr || stdout || '').trim();
      reject(new Error(`Docs build failed (exit ${code}). ${details}`));
    });
  });
}

function enqueueBuildInBackground() {
  buildQueue = buildQueue
    .catch(() => undefined)
    .then(() => runBuild())
    .then((result) => {
      console.log(`[docs-build] completed in ${result.durationMs}ms`);
      return result;
    })
    .catch((error) => {
      console.error(`[docs-build] failed: ${error.message}`);
      throw error;
    });

  return { queued: true };
}

function extractParagraphs(markdownContent) {
  const managedParagraphs = parseManagedParagraphs(markdownContent);
  if (managedParagraphs) {
    return managedParagraphs.map((paragraph) => ({
      number: paragraph.number,
      title: paragraph.title,
    }));
  }

  const fallback = parseParagraphSections(stripFrontMatter(markdownContent));
  return fallback.sections.map((section) => ({ number: section.number, title: section.title }));
}

async function findRoadmapFileBySlug(slug) {
  const safeSlug = slugify(slug);
  if (!safeSlug) {
    return null;
  }

  const mdPath = path.resolve(DOCS_ROOT, `${safeSlug}.md`);
  const mdxPath = path.resolve(DOCS_ROOT, `${safeSlug}.mdx`);

  if (!mdPath.startsWith(`${DOCS_ROOT}${path.sep}`) || !mdxPath.startsWith(`${DOCS_ROOT}${path.sep}`)) {
    return null;
  }

  try {
    await fs.access(mdPath);
    return {
      slug: safeSlug,
      filename: `${safeSlug}.md`,
      fullPath: mdPath,
    };
  } catch {
    // Continue with .mdx
  }

  try {
    await fs.access(mdxPath);
    return {
      slug: safeSlug,
      filename: `${safeSlug}.mdx`,
      fullPath: mdxPath,
    };
  } catch {
    return null;
  }
}

app.get('/api/docs/roadmap/titles', async (_req, res) => {
  try {
    const entries = await fs.readdir(DOCS_ROOT, { withFileTypes: true });
    const markdownFiles = entries
      .filter((entry) => entry.isFile() && /\.(md|mdx)$/i.test(entry.name))
      .map((entry) => entry.name);

    const items = await Promise.all(
      markdownFiles.map(async (filename) => {
        const fullPath = path.resolve(DOCS_ROOT, filename);
        const fileContent = await fs.readFile(fullPath, 'utf8');
        const slug = path.basename(filename, path.extname(filename));
        return {
          title: extractPageTitle(fileContent, slug),
          slug,
        };
      })
    );

    return res.json({ items });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while reading roadmap titles.',
      details: error.message,
    });
  }
});

app.post('/api/docs/roadmap', async (req, res) => {
  try {
    const { title, slug, description } = req.body || {};

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Field "title" is required and must be a string.' });
    }

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Field "description" is required and must be a string.' });
    }

    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: 'Field "slug" is required and must be a string.' });
    }

    const safeSlug = slugify(slug);
    if (!safeSlug) {
      return res.status(400).json({ error: 'Invalid title/slug. Unable to generate filename.' });
    }

    const filename = `${safeSlug}.md`;
    const targetPath = path.resolve(DOCS_ROOT, filename);
    if (!targetPath.startsWith(`${DOCS_ROOT}${path.sep}`)) {
      return res.status(400).json({ error: 'Invalid target path.' });
    }

    await fs.mkdir(DOCS_ROOT, { recursive: true });

    try {
      await fs.access(targetPath);
      return res.status(409).json({ error: 'File already exists.', path: `docs/06-roadmap/${filename}` });
    } catch {
      // File does not exist, continue.
    }

    const safeTitle = asSingleLine(title);
    const safeDescription = asSingleLine(description);
    const frontMatter =
      `---\n` +
      `title: "${safeTitle.replace(/"/g, '\\"')}"\n` +
      `description: "${safeDescription.replace(/"/g, '\\"')}"\n` +
      `---\n\n`;
    const fileContent = renderRoadmapPage({
      title: safeTitle,
      frontMatter,
      paragraphs: [],
    });

    await fs.writeFile(targetPath, fileContent, { encoding: 'utf8', flag: 'wx' });
    const docId = `roadmap/${safeSlug}`;
    const sidebarUpdated = await ensureRoadmapItemInSidebar(docId);
    const build = enqueueBuildInBackground();

    return res.status(201).json({
      message: 'Roadmap page created.',
      path: `docs/06-roadmap/${filename}`,
      docId,
      sidebarUpdated,
      build,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while creating roadmap page.',
      details: error.message,
    });
  }
});

app.put('/api/docs/roadmap/:slug/paragraphs', async (req, res) => {
  try {
    const roadmapFile = await findRoadmapFileBySlug(req.params.slug);
    if (!roadmapFile) {
      return res.status(404).json({ error: 'Roadmap page not found.' });
    }

    const { title, content } = req.body || {};
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Field "title" is required and must be a string.' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Field "content" is required and must be a string.' });
    }

    const fileContent = await fs.readFile(roadmapFile.fullPath, 'utf8');
    const { frontMatter } = splitFrontMatter(fileContent);
    const pageTitle = extractFrontMatterField(frontMatter, 'title') || extractFirstH1(fileContent) || roadmapFile.slug;
    const currentParagraphs = parseManagedParagraphs(fileContent) || [];

    const nextParagraph = {
      number: currentParagraphs.length + 1,
      title: asSingleLine(title),
      content: content.trim(),
    };
    const updatedParagraphs = [...currentParagraphs, nextParagraph];
    const updatedContent = renderRoadmapPage({
      title: pageTitle,
      frontMatter,
      paragraphs: updatedParagraphs,
    });

    await fs.writeFile(roadmapFile.fullPath, updatedContent, 'utf8');
    const build = enqueueBuildInBackground();

    return res.json({
      message: 'Roadmap paragraph created.',
      slug: roadmapFile.slug,
      paragraph: {
        number: nextParagraph.number,
        title: nextParagraph.title,
      },
      build,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while creating roadmap paragraph.',
      details: error.message,
    });
  }
});

app.get('/api/docs/roadmap/:slug/paragraphs', async (req, res) => {
  try {
    const roadmapFile = await findRoadmapFileBySlug(req.params.slug);
    if (!roadmapFile) {
      return res.status(404).json({ error: 'Roadmap page not found.' });
    }

    const fileContent = await fs.readFile(roadmapFile.fullPath, 'utf8');
    const title = extractPageTitle(fileContent, roadmapFile.slug);
    const paragraphs = extractParagraphs(fileContent);

    return res.json({
      slug: roadmapFile.slug,
      title,
      paragraphs,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while reading roadmap paragraphs.',
      details: error.message,
    });
  }
});

app.delete('/api/docs/roadmap/:slug', async (req, res) => {
  try {
    const roadmapFile = await findRoadmapFileBySlug(req.params.slug);
    if (!roadmapFile) {
      return res.status(404).json({ error: 'Roadmap page not found.' });
    }

    await fs.unlink(roadmapFile.fullPath);
    const docId = `roadmap/${roadmapFile.slug}`;
    const sidebarUpdated = await removeRoadmapItemFromSidebar(docId);
    const build = enqueueBuildInBackground();

    return res.json({
      message: 'Roadmap page deleted.',
      path: `docs/06-roadmap/${roadmapFile.filename}`,
      docId,
      sidebarUpdated,
      build,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while deleting roadmap page.',
      details: error.message,
    });
  }
});

app.put('/api/docs/roadmap/:slug/paragraphs/:number', async (req, res) => {
  try {
    const roadmapFile = await findRoadmapFileBySlug(req.params.slug);
    if (!roadmapFile) {
      return res.status(404).json({ error: 'Roadmap page not found.' });
    }

    const paragraphNumber = Number(req.params.number);
    if (!Number.isInteger(paragraphNumber) || paragraphNumber <= 0) {
      return res.status(400).json({ error: 'Invalid paragraph number.' });
    }

    const { title, content } = req.body || {};
    if (title !== undefined && typeof title !== 'string') {
      return res.status(400).json({ error: 'Field "title" must be a string when provided.' });
    }
    if (content !== undefined && typeof content !== 'string') {
      return res.status(400).json({ error: 'Field "content" must be a string when provided.' });
    }
    if (title === undefined && content === undefined) {
      return res.status(400).json({ error: 'Provide at least one field: "title" or "content".' });
    }

    const fileContent = await fs.readFile(roadmapFile.fullPath, 'utf8');
    const { frontMatter } = splitFrontMatter(fileContent);
    const pageTitle = extractFrontMatterField(frontMatter, 'title') || extractFirstH1(fileContent) || roadmapFile.slug;
    const currentParagraphs = parseManagedParagraphs(fileContent) || [];
    const targetIndex = currentParagraphs.findIndex((paragraph) => paragraph.number === paragraphNumber);

    if (targetIndex === -1) {
      return res.status(404).json({ error: 'Paragraph not found for this roadmap page.' });
    }

    const currentParagraph = currentParagraphs[targetIndex];
    const updatedParagraph = {
      number: currentParagraph.number,
      title: title !== undefined ? asSingleLine(title) : currentParagraph.title,
      content: content !== undefined ? content.trim() : currentParagraph.content,
    };

    const updatedParagraphs = currentParagraphs.map((paragraph, index) =>
      index === targetIndex ? updatedParagraph : paragraph
    );
    const updatedContent = renderRoadmapPage({
      title: pageTitle,
      frontMatter,
      paragraphs: updatedParagraphs,
    });

    await fs.writeFile(roadmapFile.fullPath, updatedContent, 'utf8');
    const build = enqueueBuildInBackground();

    return res.json({
      message: 'Roadmap paragraph updated.',
      slug: roadmapFile.slug,
      paragraph: {
        number: updatedParagraph.number,
        title: updatedParagraph.title,
      },
      build,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while updating roadmap paragraph.',
      details: error.message,
    });
  }
});

app.delete('/api/docs/roadmap/:slug/paragraphs/:number', async (req, res) => {
  try {
    const roadmapFile = await findRoadmapFileBySlug(req.params.slug);
    if (!roadmapFile) {
      return res.status(404).json({ error: 'Roadmap page not found.' });
    }

    const paragraphNumber = Number(req.params.number);
    if (!Number.isInteger(paragraphNumber) || paragraphNumber <= 0) {
      return res.status(400).json({ error: 'Invalid paragraph number.' });
    }

    const fileContent = await fs.readFile(roadmapFile.fullPath, 'utf8');
    const { frontMatter } = splitFrontMatter(fileContent);
    const pageTitle = extractFrontMatterField(frontMatter, 'title') || extractFirstH1(fileContent) || roadmapFile.slug;
    const currentParagraphs = parseManagedParagraphs(fileContent) || [];
    const targetParagraph = currentParagraphs.find((paragraph) => paragraph.number === paragraphNumber);

    if (!targetParagraph) {
      return res.status(404).json({ error: 'Paragraph not found for this roadmap page.' });
    }
    const updatedParagraphs = currentParagraphs
      .filter((paragraph) => paragraph.number !== paragraphNumber)
      .map((paragraph, index) => ({
        number: index + 1,
        title: paragraph.title,
        content: paragraph.content,
      }));
    const updatedContent = renderRoadmapPage({
      title: pageTitle,
      frontMatter,
      paragraphs: updatedParagraphs,
    });

    await fs.writeFile(roadmapFile.fullPath, updatedContent, 'utf8');
    const build = enqueueBuildInBackground();

    return res.json({
      message: 'Roadmap paragraph deleted.',
      slug: roadmapFile.slug,
      deleted: {
        number: targetParagraph.number,
        title: targetParagraph.title,
      },
      build,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while deleting roadmap paragraph.',
      details: error.message,
    });
  }
});

app.get('/api/docs/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Docs API listening on port ${PORT}`);
});
