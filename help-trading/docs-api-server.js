const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.DOCS_API_PORT || 3106);
const DOCS_ROOT = path.resolve(__dirname, 'docs', '06-roadmap');
const SIDEBAR_PATH = path.resolve(__dirname, 'sidebars.js');
const DOCS_CONFIG_PATH = path.resolve(__dirname, 'docusaurus.config.js');
const PARAGRAPHS_START_MARKER = '<!-- ROADMAP_PARAGRAPHS_START -->';
const PARAGRAPHS_END_MARKER = '<!-- ROADMAP_PARAGRAPHS_END -->';
const BUILD_TIMEOUT_MS = Number(process.env.DOCS_BUILD_TIMEOUT_MS || 300000);
const GIT_TIMEOUT_MS = Number(process.env.DOCS_GIT_TIMEOUT_MS || 120000);
const GIT_REMOTE = String(process.env.DOCS_GIT_REMOTE || 'org').trim();
const GIT_REMOTE_URL = String(process.env.DOCS_GIT_REMOTE_URL || '').trim();
const GIT_BRANCH = String(process.env.DOCS_GIT_BRANCH || 'mcp').trim() || 'mcp';
const GIT_PUSH_ENABLED = String(process.env.DOCS_GIT_PUSH_ENABLED || 'true').toLowerCase() !== 'false';
const GIT_AUTHOR_NAME = process.env.DOCS_GIT_AUTHOR_NAME || 'help-trading-bot';
const GIT_AUTHOR_EMAIL = process.env.DOCS_GIT_AUTHOR_EMAIL || 'help-trading-bot@local';
const GIT_HTTP_USERNAME = process.env.DOCS_GIT_HTTP_USERNAME || 'x-access-token';
const GIT_HTTP_TOKEN = process.env.DOCS_GIT_HTTP_TOKEN || '';

let buildQueue = Promise.resolve();
let pushQueue = Promise.resolve();

function logInfo(scope, message) {
  console.info(`[${scope}] ${message}`);
}

function logWarn(scope, message) {
  console.warn(`[${scope}] ${message}`);
}

function logError(scope, message) {
  console.error(`[${scope}] ${message}`);
}

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
    throw new Error('Roadmap section not found in sidebars.js');
  }

  const itemsStartIndex = sidebarContent.indexOf(marker, anchorIndex);
  if (itemsStartIndex === -1) {
    throw new Error('Roadmap items array not found in sidebars.js');
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

function parseFallbackParagraphs(markdownContent) {
  const { body } = splitFrontMatter(markdownContent);
  const parsed = parseParagraphSections(body);

  return parsed.sections.map((section, index) => ({
    number: index + 1,
    title: section.title,
    content: parsed.lines.slice(section.startLine + 1, section.endLine).join('\n').trim(),
  }));
}

function appendFallbackParagraph(markdownContent, paragraph) {
  const { frontMatter, body } = splitFrontMatter(markdownContent);
  const section = `## ${paragraph.title}\n\n${paragraph.content.trim()}`;
  const trimmedBody = body.replace(/\s+$/, '');
  const nextBody = trimmedBody ? `${trimmedBody}\n\n${section}\n` : `${section}\n`;
  return `${frontMatter}${nextBody}`;
}

function updateFallbackParagraph(markdownContent, paragraphNumber, updates) {
  const { frontMatter, body } = splitFrontMatter(markdownContent);
  const parsed = parseParagraphSections(body);
  const target = parsed.sections[paragraphNumber - 1];
  if (!target) {
    return null;
  }

  const currentTitle = target.title;
  const currentContent = parsed.lines.slice(target.startLine + 1, target.endLine).join('\n').trim();
  const nextTitle = updates.title !== undefined ? asSingleLine(updates.title) : currentTitle;
  const nextContent = updates.content !== undefined ? updates.content.trim() : currentContent;
  const replacement = `## ${nextTitle}\n\n${nextContent}`;

  const before = parsed.lines.slice(0, target.startLine).join('\n').trimEnd();
  const after = parsed.lines.slice(target.endLine).join('\n').trimStart();
  const nextBody = [before, replacement, after].filter(Boolean).join('\n\n');

  return {
    markdownContent: `${frontMatter}${nextBody}\n`,
    paragraph: {
      number: paragraphNumber,
      title: nextTitle,
    },
  };
}

function deleteFallbackParagraph(markdownContent, paragraphNumber) {
  const { frontMatter, body } = splitFrontMatter(markdownContent);
  const parsed = parseParagraphSections(body);
  const target = parsed.sections[paragraphNumber - 1];
  if (!target) {
    return null;
  }

  const before = parsed.lines.slice(0, target.startLine).join('\n').trimEnd();
  const after = parsed.lines.slice(target.endLine).join('\n').trimStart();
  const nextBody = [before, after].filter(Boolean).join('\n\n');

  return {
    markdownContent: nextBody ? `${frontMatter}${nextBody}\n` : frontMatter,
    paragraph: {
      number: paragraphNumber,
      title: target.title,
    },
  };
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

function createStageError(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  return error;
}

function commandDetails(result) {
  return (result.stderr || result.stdout || '').trim();
}

function runCommand(command, args, { timeoutMs, env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: cwd || __dirname,
      env: { ...process.env, ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs || BUILD_TIMEOUT_MS}ms`));
    }, timeoutMs || BUILD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - startedAt });
        return;
      }

      const details = (stderr || stdout || '').trim();
      reject(new Error(`${command} ${args.join(' ')} failed (exit ${code}). ${details}`));
    });
  });
}

function gitEnv() {
  return {
    GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: GIT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: GIT_AUTHOR_EMAIL,
  };
}

async function ensureGitAskPassScript() {
  const scriptPath = path.join(os.tmpdir(), 'help-trading-git-askpass.sh');
  const scriptContent = `#!/bin/sh
case "$1" in
  *Username*) printf '%s' "$DOCS_GIT_HTTP_USERNAME" ;;
  *Password*) printf '%s' "$DOCS_GIT_HTTP_TOKEN" ;;
  *) printf '' ;;
esac
`;
  await fs.writeFile(scriptPath, scriptContent, { mode: 0o700 });
  await fs.chmod(scriptPath, 0o700);
  return scriptPath;
}

async function getGitPushOptions(branch) {
  if (GIT_REMOTE_URL && GIT_HTTP_TOKEN) {
    const askPass = await ensureGitAskPassScript();
    return {
      target: GIT_REMOTE_URL,
      args: ['push', GIT_REMOTE_URL, `HEAD:${branch}`],
      env: {
        ...gitEnv(),
        GIT_ASKPASS: askPass,
        SSH_ASKPASS: askPass,
        GIT_TERMINAL_PROMPT: '0',
        DOCS_GIT_HTTP_USERNAME: GIT_HTTP_USERNAME,
        DOCS_GIT_HTTP_TOKEN: GIT_HTTP_TOKEN,
      },
      authMode: 'https-token',
    };
  }

  return {
    target: GIT_REMOTE,
    args: ['push', GIT_REMOTE, branch],
    env: gitEnv(),
    authMode: 'git-remote',
  };
}

async function isLocalGitRepository() {
  try {
    const result = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
    });
    return result.stdout === 'true';
  } catch {
    return false;
  }
}

async function resolveRemoteUrl() {
  if (GIT_REMOTE_URL) {
    return GIT_REMOTE_URL;
  }

  const hasLocalGit = await isLocalGitRepository();
  if (!hasLocalGit) {
    throw createStageError('git_config', 'DOCS_GIT_REMOTE_URL is required when the service is running outside a git repository.');
  }

  try {
    const result = await runCommand('git', ['remote', 'get-url', GIT_REMOTE], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
    });
    return result.stdout.trim();
  } catch (error) {
    throw createStageError('git_config', `Unable to resolve git remote "${GIT_REMOTE}". ${error.message}`);
  }
}

async function copyPublishableDocs(targetHelpTradingDir) {
  await fs.cp(path.join(__dirname, 'docs'), path.join(targetHelpTradingDir, 'docs'), { recursive: true, force: true });
  await fs.copyFile(SIDEBAR_PATH, path.join(targetHelpTradingDir, 'sidebars.js'));
  await fs.copyFile(DOCS_CONFIG_PATH, path.join(targetHelpTradingDir, 'docusaurus.config.js'));
}

async function persistDocsChangesViaClone() {
  const branch = GIT_BRANCH;
  const remoteUrl = await resolveRemoteUrl();
  const pushOptions = await getGitPushOptions(branch);
  const cloneRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'help-trading-publish-'));

  logWarn('docs-git', 'local workspace is not a git repository, using temporary clone publish flow');
  logInfo('docs-git', `cloning publish workspace from target=${remoteUrl} branch=${branch}`);

  try {
    await runCommand('git', ['clone', '--depth', '1', '--branch', branch, remoteUrl, cloneRoot], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: pushOptions.env,
    });
  } catch (error) {
    throw createStageError('git_clone', `Git clone failed for branch "${branch}" from "${remoteUrl}". ${error.message}`);
  }

  const targetHelpTradingDir = path.join(cloneRoot, 'help-trading');
  await copyPublishableDocs(targetHelpTradingDir);

  logInfo('docs-git', 'staging documentation changes in cloned workspace');
  try {
    await runCommand('git', ['add', '--', 'docs', 'sidebars.js', 'docusaurus.config.js'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
      cwd: targetHelpTradingDir,
    });
  } catch (error) {
    throw createStageError('git_stage', `Git add failed in cloned workspace. ${error.message}`);
  }

  try {
    await runCommand('git', ['diff', '--cached', '--quiet'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
      cwd: targetHelpTradingDir,
    });
    return { skipped: true, reason: 'no changes to commit', branch, remote: remoteUrl, authMode: pushOptions.authMode };
  } catch {
    // Staged changes detected.
  }

  const timestamp = new Date().toISOString();
  const message = `docs(help-trading): persist documentation changes ${timestamp}`;
  logInfo('docs-git', `creating commit in cloned workspace on branch=${branch} message="${message}"`);

  let commitResult;
  try {
    commitResult = await runCommand('git', ['commit', '-m', message], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
      cwd: targetHelpTradingDir,
    });
  } catch (error) {
    throw createStageError('git_commit', `Git commit failed in cloned workspace. ${error.message}`);
  }

  logInfo('docs-git', `pushing cloned workspace to target=${pushOptions.target} branch=${branch} auth=${pushOptions.authMode}`);

  let pushResult;
  try {
    pushResult = await runCommand('git', pushOptions.args, {
      timeoutMs: GIT_TIMEOUT_MS,
      env: pushOptions.env,
      cwd: targetHelpTradingDir,
    });
  } catch (error) {
    throw createStageError('git_push', `Git push failed for target "${pushOptions.target}" branch "${branch}". ${error.message}`);
  }

  return {
    skipped: false,
    branch,
    remote: pushOptions.target,
    authMode: pushOptions.authMode,
    commitSummary: commandDetails(commitResult).split(/\r?\n/).slice(-1)[0] || 'committed',
    pushSummary: commandDetails(pushResult) || 'pushed',
  };
}

async function persistDocsChanges() {
  if (!GIT_PUSH_ENABLED) {
    return { skipped: true, reason: 'git push disabled', branch: GIT_BRANCH };
  }

  const hasLocalGit = await isLocalGitRepository();
  if (!hasLocalGit) {
    return persistDocsChangesViaClone();
  }

  logInfo('docs-git', 'staging documentation changes');
  try {
    await runCommand('git', ['add', '--', 'docs', 'sidebars.js', 'docusaurus.config.js'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
    });
  } catch (error) {
    throw createStageError('git_stage', `Git add failed in local repository. ${error.message}`);
  }

  try {
    await runCommand('git', ['diff', '--cached', '--quiet'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
    });
    return { skipped: true, reason: 'no changes to commit', branch: GIT_BRANCH };
  } catch {
    // Staged changes detected.
  }

  const branch = GIT_BRANCH;
  const timestamp = new Date().toISOString();
  const message = `docs(help-trading): persist documentation changes ${timestamp}`;
  logInfo('docs-git', `creating commit on branch=${branch} message="${message}"`);

  let commitResult;
  try {
    commitResult = await runCommand('git', ['commit', '-m', message], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: gitEnv(),
    });
  } catch (error) {
    throw createStageError('git_commit', `Git commit failed in local repository. ${error.message}`);
  }

  const pushOptions = await getGitPushOptions(branch);
  logInfo('docs-git', `pushing to target=${pushOptions.target} branch=${branch} auth=${pushOptions.authMode}`);

  let pushResult;
  try {
    pushResult = await runCommand('git', pushOptions.args, {
      timeoutMs: GIT_TIMEOUT_MS,
      env: pushOptions.env,
    });
  } catch (error) {
    throw createStageError('git_push', `Git push failed for target "${pushOptions.target}" branch "${branch}". ${error.message}`);
  }

  return {
    skipped: false,
    branch,
    remote: pushOptions.target,
    authMode: pushOptions.authMode,
    commitSummary: commandDetails(commitResult).split(/\r?\n/).slice(-1)[0] || 'committed',
    pushSummary: commandDetails(pushResult) || 'pushed',
  };
}

async function runDocsBuild() {
  logInfo('docs-build', 'starting documentation rebuild');

  let buildResult;
  try {
    buildResult = await runCommand('npm', ['run', 'build'], { timeoutMs: BUILD_TIMEOUT_MS });
  } catch (error) {
    throw createStageError('build', `Docs build failed. ${error.message}`);
  }

  logInfo('docs-build', `completed in ${buildResult.durationMs}ms`);
  return { durationMs: buildResult.durationMs };
}

async function runDocsPush() {
  const gitResult = await persistDocsChanges();
  if (gitResult.skipped) {
    logWarn('docs-git', `skipped: ${gitResult.reason}`);
  } else {
    logInfo('docs-git', `push completed target=${gitResult.remote} branch=${gitResult.branch} auth=${gitResult.authMode}`);
    logInfo('docs-git', `commit: ${gitResult.commitSummary}`);
    logInfo('docs-git', `push: ${gitResult.pushSummary}`);
  }
  return gitResult;
}

function queueBuildJob() {
  const job = buildQueue.catch(() => undefined).then(() => runDocsBuild());
  buildQueue = job.catch(() => undefined);
  return job;
}

function queuePushJob() {
  const job = pushQueue.catch(() => undefined).then(() => runDocsPush());
  pushQueue = job.catch(() => undefined);
  return job;
}

function extractParagraphs(markdownContent) {
  const managedParagraphs = parseManagedParagraphs(markdownContent);
  if (managedParagraphs) {
    return managedParagraphs.map((paragraph) => ({
      number: paragraph.number,
      title: paragraph.title,
      content: paragraph.content,
    }));
  }

  return parseFallbackParagraphs(markdownContent).map((paragraph) => ({
    number: paragraph.number,
    title: paragraph.title,
    content: paragraph.content,
  }));
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
    return res.status(201).json({
      message: 'Roadmap page created.',
      path: `docs/06-roadmap/${filename}`,
      docId,
      sidebarUpdated,
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
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Field "title" is required and must be a non-empty string.' });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Field "content" is required and must be a non-empty string.' });
    }

    const fileContent = await fs.readFile(roadmapFile.fullPath, 'utf8');
    const managedParagraphs = parseManagedParagraphs(fileContent);

    const nextParagraph = {
      number: (managedParagraphs || parseFallbackParagraphs(fileContent)).length + 1,
      title: asSingleLine(title),
      content: content.trim(),
    };

    let updatedContent;
    if (managedParagraphs) {
      const { frontMatter } = splitFrontMatter(fileContent);
      const pageTitle = extractFrontMatterField(frontMatter, 'title') || extractFirstH1(fileContent) || roadmapFile.slug;
      const updatedParagraphs = [...managedParagraphs, nextParagraph];
      updatedContent = renderRoadmapPage({
        title: pageTitle,
        frontMatter,
        paragraphs: updatedParagraphs,
      });
    } else {
      updatedContent = appendFallbackParagraph(fileContent, nextParagraph);
    }

    await fs.writeFile(roadmapFile.fullPath, updatedContent, 'utf8');
    return res.json({
      message: 'Roadmap paragraph created.',
      slug: roadmapFile.slug,
      paragraph: {
        number: nextParagraph.number,
        title: nextParagraph.title,
      },
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
    return res.json({
      message: 'Roadmap page deleted.',
      path: `docs/06-roadmap/${roadmapFile.filename}`,
      docId,
      sidebarUpdated,
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
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: 'Field "title" must be a non-empty string when provided.' });
    }
    if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ error: 'Field "content" must be a non-empty string when provided.' });
    }
    if (title === undefined && content === undefined) {
      return res.status(400).json({ error: 'Provide at least one field: "title" or "content".' });
    }

    const fileContent = await fs.readFile(roadmapFile.fullPath, 'utf8');
    const managedParagraphs = parseManagedParagraphs(fileContent);

    if (managedParagraphs) {
      const { frontMatter } = splitFrontMatter(fileContent);
      const pageTitle = extractFrontMatterField(frontMatter, 'title') || extractFirstH1(fileContent) || roadmapFile.slug;
      const targetIndex = managedParagraphs.findIndex((paragraph) => paragraph.number === paragraphNumber);

      if (targetIndex === -1) {
        return res.status(404).json({ error: 'Paragraph not found for this roadmap page.' });
      }

      const currentParagraph = managedParagraphs[targetIndex];
      const updatedParagraph = {
        number: currentParagraph.number,
        title: title !== undefined ? asSingleLine(title) : currentParagraph.title,
        content: content !== undefined ? content.trim() : currentParagraph.content,
      };

      const updatedParagraphs = managedParagraphs.map((paragraph, index) =>
        index === targetIndex ? updatedParagraph : paragraph
      );
      const updatedContent = renderRoadmapPage({
        title: pageTitle,
        frontMatter,
        paragraphs: updatedParagraphs,
      });

      await fs.writeFile(roadmapFile.fullPath, updatedContent, 'utf8');
      return res.json({
        message: 'Roadmap paragraph updated.',
        slug: roadmapFile.slug,
        paragraph: {
          number: updatedParagraph.number,
          title: updatedParagraph.title,
        },
      });
    }

    const fallbackUpdate = updateFallbackParagraph(fileContent, paragraphNumber, { title, content });
    if (!fallbackUpdate) {
      return res.status(404).json({ error: 'Paragraph not found for this roadmap page.' });
    }

    await fs.writeFile(roadmapFile.fullPath, fallbackUpdate.markdownContent, 'utf8');
    return res.json({
      message: 'Roadmap paragraph updated.',
      slug: roadmapFile.slug,
      paragraph: fallbackUpdate.paragraph,
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
    const managedParagraphs = parseManagedParagraphs(fileContent);

    if (managedParagraphs) {
      const { frontMatter } = splitFrontMatter(fileContent);
      const pageTitle = extractFrontMatterField(frontMatter, 'title') || extractFirstH1(fileContent) || roadmapFile.slug;
      const targetParagraph = managedParagraphs.find((paragraph) => paragraph.number === paragraphNumber);

      if (!targetParagraph) {
        return res.status(404).json({ error: 'Paragraph not found for this roadmap page.' });
      }
      const updatedParagraphs = managedParagraphs
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
      return res.json({
        message: 'Roadmap paragraph deleted.',
        slug: roadmapFile.slug,
        deleted: {
          number: targetParagraph.number,
          title: targetParagraph.title,
        },
      });
    }

    const fallbackDelete = deleteFallbackParagraph(fileContent, paragraphNumber);
    if (!fallbackDelete) {
      return res.status(404).json({ error: 'Paragraph not found for this roadmap page.' });
    }

    await fs.writeFile(roadmapFile.fullPath, fallbackDelete.markdownContent, 'utf8');
    return res.json({
      message: 'Roadmap paragraph deleted.',
      slug: roadmapFile.slug,
      deleted: fallbackDelete.paragraph,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected error while deleting roadmap paragraph.',
      details: error.message,
    });
  }
});

app.post('/api/docs/rebuild', async (_req, res) => {
  try {
    const result = await queueBuildJob();
    return res.json({
      message: 'Docs rebuild completed.',
      build: result,
    });
  } catch (error) {
    logError('docs-build', error.message);
    return res.status(500).json({
      error: 'Docs rebuild failed.',
      stage: 'build',
      details: error.message,
    });
  }
});

app.post('/api/docs/push', async (_req, res) => {
  try {
    const result = await queuePushJob();
    return res.json({
      message: 'Docs push completed.',
      git: result,
    });
  } catch (error) {
    logError('docs-publish', error.message);
    return res.status(500).json({
      error: 'Docs push failed.',
      stage: 'push_git',
      details: error.message,
    });
  }
});

app.get('/api/docs/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  logInfo('docs-api', `listening on port ${PORT}`);
});
