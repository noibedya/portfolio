const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── ADMIN PASSWORD ──────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'portfolio2025';

// ── PATHS (Vercel uses /tmp for writable storage) ───────────────────────────
const IS_VERCEL   = !!process.env.VERCEL;
const DATA_FILE   = IS_VERCEL ? '/tmp/projects.json'  : path.join(__dirname, 'data', 'projects.json');
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads'        : path.join(__dirname, 'public', 'uploads');

// Ensure directories exist
[IS_VERCEL ? '/tmp' : path.join(__dirname, 'data'), UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Seed projects file — on Vercel, pre-load from the committed JSON if /tmp is empty
if (!fs.existsSync(DATA_FILE)) {
  const committed = path.join(__dirname, 'data', 'projects.json');
  const seed = fs.existsSync(committed) ? fs.readFileSync(committed, 'utf8') : '[]';
  fs.writeFileSync(DATA_FILE, seed);
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
const readProjects  = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeProjects = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// ── GITHUB SYNC ──────────────────────────────────────────────────────────────
// Commits the current /tmp/projects.json back to the repo so it survives cold starts.
async function syncToGitHub() {
  if (!IS_VERCEL) return; // only needed on Vercel
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  try {
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    const encoded = Buffer.from(content).toString('base64');

    // Get current file SHA (required by GitHub Contents API for updates)
    const getRes = await fetch('https://api.github.com/repos/noibedya/portfolio/contents/data/projects.json', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'portfolio-cms'
      }
    });
    const { sha } = await getRes.json();

    // Commit the updated file
    await fetch('https://api.github.com/repos/noibedya/portfolio/contents/data/projects.json', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'portfolio-cms'
      },
      body: JSON.stringify({
        message: 'chore: sync projects data',
        content: encoded,
        sha
      })
    });
  } catch (err) {
    // Non-fatal — log but don't crash the request
    console.error('[syncToGitHub] failed:', err.message);
  }
}

// ── MULTER ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
    cb(null, name);
  }
});

const fileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  cb(null, allowed.includes(file.mimetype));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

// ── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'noibedya-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Serve uploads — on Vercel, serve from /tmp/uploads
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(UPLOADS_DIR, req.path.replace(/^\//, ''));
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ── PUBLIC API ───────────────────────────────────────────────────────────────
app.get('/api/projects', (_req, res) => {
  const projects = readProjects().filter(p => p.published);
  res.json(projects.sort((a, b) => a.order - b.order || new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/projects/:id', (req, res) => {
    const project = readProjects().find(p => p.id === req.params.id && p.published);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
});

// ── ADMIN AUTH ───────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

app.post('/api/admin/cloudinary-sign', requireAuth, (req, res) => {
    const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
    if (!cloudName || !apiKey || !apiSecret) return res.status(503).json({ error: 'Cloudinary not configured' });
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'portfolio';
    const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
    res.json({ timestamp, signature, apiKey, cloudName, folder });
});

// ── ADMIN PROJECT API ────────────────────────────────────────────────────────
app.get('/api/admin/projects', requireAuth, (_req, res) => {
  res.json(readProjects().sort((a, b) => a.order - b.order || new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post('/api/admin/projects',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'images', maxCount: 20 }]),
  (req, res) => {
    const projects = readProjects();
    const { title, category, description, summary, tags, tools, role, duration, link, published, featured, order } = req.body;
    const cover  = req.body.coverUrl || req.files?.cover?.[0]?.filename || null;
    const images = [...(req.body.imageUrls ? [].concat(req.body.imageUrls) : []), ...(req.files?.images || []).map(f => f.filename)];

    const project = {
      id: uuidv4(), title: title || 'Untitled', category: category || '',
      summary: summary || '', description: description || '',
      tags:  tags  ? tags.split(',').map(t => t.trim()).filter(Boolean)  : [],
      tools: tools ? tools.split(',').map(t => t.trim()).filter(Boolean) : [],
      role: role || '', duration: duration || '', link: link || '',
      cover, images,
      published: published === 'true' || published === true,
      featured:  featured  === 'true' || featured  === true,
      order: parseInt(order) || projects.length,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };

    projects.push(project);
    writeProjects(projects);
    syncToGitHub(); // fire-and-forget
    res.status(201).json(project);
  }
);

app.put('/api/admin/projects/:id',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'images', maxCount: 20 }]),
  (req, res) => {
    const projects = readProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const existing = projects[idx];
    const { title, category, description, summary, tags, tools, role, duration, link, published, featured, order, removeImages } = req.body;

    let currentImages = [...(existing.images || [])];
    if (removeImages) {
      const toRemove = Array.isArray(removeImages) ? removeImages : [removeImages];
      toRemove.forEach(filename => {
        const filePath = path.join(UPLOADS_DIR, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        currentImages = currentImages.filter(f => f !== filename);
      });
    }

    const newCover = req.body.coverUrl || req.files?.cover?.[0]?.filename || null;
    if (newCover && existing.cover) {
      const oldPath = path.join(UPLOADS_DIR, existing.cover);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const updated = {
      ...existing,
      title: title ?? existing.title, category: category ?? existing.category,
      summary: summary ?? existing.summary, description: description ?? existing.description,
      tags:  tags  ? tags.split(',').map(t => t.trim()).filter(Boolean)  : existing.tags,
      tools: tools ? tools.split(',').map(t => t.trim()).filter(Boolean) : existing.tools,
      role: role ?? existing.role, duration: duration ?? existing.duration, link: link ?? existing.link,
      cover: newCover || existing.cover,
      images: [...currentImages, ...(req.body.imageUrls ? [].concat(req.body.imageUrls) : []), ...(req.files?.images || []).map(f => f.filename)],
      published: published !== undefined ? (published === 'true' || published === true) : existing.published,
      featured:  featured  !== undefined ? (featured  === 'true' || featured  === true) : existing.featured,
      order: order !== undefined ? (parseInt(order) || 0) : existing.order,
      updatedAt: new Date().toISOString()
    };

    projects[idx] = updated;
    writeProjects(projects);
    syncToGitHub(); // fire-and-forget
    res.json(updated);
  }
);

app.delete('/api/admin/projects/:id', requireAuth, (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = projects.splice(idx, 1);
  [removed.cover, ...(removed.images || [])].filter(Boolean).forEach(f => {
    const fp = path.join(UPLOADS_DIR, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  writeProjects(projects);
  syncToGitHub(); // fire-and-forget
  res.json({ ok: true });
});

app.post('/api/admin/projects/reorder', requireAuth, (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds must be array' });
  const projects = readProjects();
  const map = Object.fromEntries(projects.map(p => [p.id, p]));
  const reordered = orderedIds.map((id, i) => ({ ...map[id], order: i })).filter(Boolean);
  writeProjects(reordered);
  syncToGitHub(); // fire-and-forget
  res.json({ ok: true });
});

// ── START SERVER (local only) ────────────────────────────────────────────────
if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✓ Portfolio server running at http://localhost:${PORT}`);
    console.log(`✓ Admin panel:      http://localhost:${PORT}/admin`);
    console.log(`✓ API endpoints:    http://localhost:${PORT}/api/projects\n`);
  });
}

module.exports = app;
