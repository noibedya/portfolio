const express       = require('express');
const multer        = require('multer');
const cors          = require('cors');
const cookieSession = require('cookie-session');
const path          = require('path');
const fs            = require('fs');
const crypto        = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'portfolio2025';

const IS_VERCEL  = !!process.env.VERCEL;
const DATA_FILE  = IS_VERCEL ? '/tmp/projects.json' : path.join(__dirname, 'data', 'projects.json');
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'public', 'uploads');

[IS_VERCEL ? '/tmp' : path.join(__dirname, 'data'), UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ââ Cloudinary persistence (survives Vercel Lambda cold starts) âââââââââââââââ
const CLOUD_NAME   = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUD_KEY    = process.env.CLOUDINARY_API_KEY;
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET;
const DATA_PID     = 'portfolio_data/projects';

async function cloudinaryFetch() {
  if (!CLOUD_NAME) return null;
  try {
    const r = await fetch(
      `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${DATA_PID}.json`,
      { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) ? data : null;
  } catch(e) { return null; }
}

async function cloudinaryPush(data) {
  if (!CLOUD_NAME || !CLOUD_KEY || !CLOUD_SECRET) return;
  const jsonStr = JSON.stringify(data);
  const b64     = Buffer.from(jsonStr).toString('base64');
  const dataUri = `data:application/json;base64,${b64}`;
  const ts      = Math.round(Date.now() / 1000);
  const sigStr  = `invalidate=true&overwrite=true&public_id=${DATA_PID}&resource_type=raw&timestamp=${ts}`;
  const sig     = crypto.createHash('sha1').update(sigStr + CLOUD_SECRET).digest('hex');
  const body    = new URLSearchParams({
    file: dataUri, api_key: CLOUD_KEY, timestamp: String(ts),
    signature: sig, public_id: DATA_PID, overwrite: 'true', invalidate: 'true'
  });
  try {
    await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, { method: 'POST', body });
  } catch(e) { console.error('Cloudinary push failed:', e.message); }
}

// ââ Project data helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function readProjects() {
  // Warm Lambda: /tmp cache exists â use it
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
  }
  // Cold Lambda on Vercel: restore from Cloudinary
  if (IS_VERCEL) {
    const cloud = await cloudinaryFetch();
    if (cloud) { fs.writeFileSync(DATA_FILE, JSON.stringify(cloud, null, 2)); return cloud; }
  }
  // Fallback: seed from committed data file
  const committed = path.join(__dirname, 'data', 'projects.json');
  const seed = fs.existsSync(committed) ? fs.readFileSync(committed, 'utf8') : '[]';
  fs.writeFileSync(DATA_FILE, seed);
  return JSON.parse(seed);
}

function writeProjects(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  if (IS_VERCEL) cloudinaryPush(data); // fire-and-forget
}

// ââ Multer ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});
const fileFilter = (_req, file, cb) => {
  const ok = ['image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/quicktime','video/webm','video/avi','video/mov',
    'application/pdf'].includes(file.mimetype);
  cb(null, ok);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } });

// ââ Middleware ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'noibedya-secret-key-2025'],
  maxAge: 8 * 60 * 60 * 1000,
  sameSite: 'lax',
  secure: false
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use('/uploads', (req, res, next) => {
  const fp = path.join(UPLOADS_DIR, req.path.replace(/^\//, ''));
  if (fs.existsSync(fp)) res.sendFile(fp); else next();
});

const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ââ Public ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.get('/api/projects', async (_req, res) => {
  const p = await readProjects();
  res.json(p.filter(x => x.published)
    .sort((a, b) => (a.order - b.order) || (new Date(b.createdAt) - new Date(a.createdAt))));
});

// ââ Auth ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});
app.post('/api/admin/logout', (req, res) => { req.session = null; res.json({ success: true }); });
app.get('/api/admin/check',  (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

// ââ Cloudinary signing ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.post('/api/admin/cloudinary-sign', requireAuth, (req, res) => {
  if (!CLOUD_NAME || !CLOUD_KEY || !CLOUD_SECRET)
    return res.status(503).json({ error: 'Cloudinary not configured' });
  const ts  = Math.round(Date.now() / 1000);
  const folder = 'portfolio';
  const sig = crypto.createHash('sha1')
    .update(`folder=${folder}&timestamp=${ts}${CLOUD_SECRET}`).digest('hex');
  res.json({ timestamp: ts, signature: sig, apiKey: CLOUD_KEY, cloudName: CLOUD_NAME, folder });
});

// ââ Admin projects ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.get('/api/admin/projects', requireAuth, async (_req, res) => {
  const p = await readProjects();
  res.json(p.sort((a, b) => (a.order - b.order) || (new Date(b.createdAt) - new Date(a.createdAt))));
});

app.post('/api/admin/projects',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'images', maxCount: 20 }]),
  async (req, res) => {
    const projects  = await readProjects();
    const { title, category, description, summary, tags, tools, role, duration, link, published, featured, order } = req.body;
    const coverUrl  = req.body.coverUrl || null;
    const cover     = req.files?.cover?.[0]?.filename || coverUrl || null;
    const imageUrls = req.body.imageUrls
      ? (Array.isArray(req.body.imageUrls) ? req.body.imageUrls : [req.body.imageUrls]) : [];
    const images    = [...imageUrls, ...(req.files?.images || []).map(f => f.filename)];
    const project   = {
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
    res.status(201).json(project);
  }
);

app.put('/api/admin/projects/:id',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'images', maxCount: 20 }]),
  async (req, res) => {
    const projects = await readProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const existing = projects[idx];
    const { title, category, description, summary, tags, tools, role, duration, link,
            published, featured, order, removeImages } = req.body;

    let imgs = [...(existing.images || [])];
    if (removeImages) {
      (Array.isArray(removeImages) ? removeImages : [removeImages]).forEach(f => {
        if (!f.startsWith('http')) {
          const fp = path.join(UPLOADS_DIR, f);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        imgs = imgs.filter(x => x !== f);
      });
    }
    const coverUrl   = req.body.coverUrl || null;
    const newCover   = req.files?.cover?.[0]?.filename || coverUrl || null;
    if (newCover && existing.cover && !existing.cover.startsWith('http')) {
      const old = path.join(UPLOADS_DIR, existing.cover);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    const imageUrls = req.body.imageUrls
      ? (Array.isArray(req.body.imageUrls) ? req.body.imageUrls : [req.body.imageUrls]) : [];
    const updated = {
      ...existing,
      title:       title       ?? existing.title,
      category:    category    ?? existing.category,
      summary:     summary     ?? existing.summary,
      description: description ?? existing.description,
      tags:  tags  ? tags.split(',').map(t => t.trim()).filter(Boolean)  : existing.tags,
      tools: tools ? tools.split(',').map(t => t.trim()).filter(Boolean) : existing.tools,
      role:     role     ?? existing.role,
      duration: duration ?? existing.duration,
      link:     link     ?? existing.link,
      cover:    newCover || existing.cover,
      images:   [...imgs, ...imageUrls, ...(req.files?.images || []).map(f => f.filename)],
      published: published !== undefined ? (published === 'true' || published === true) : existing.published,
      featured:  featured  !== undefined ? (featured  === 'true' || featured  === true) : existing.featured,
      order:     order !== undefined ? (parseInt(order) || 0) : existing.order,
      updatedAt: new Date().toISOString()
    };
    projects[idx] = updated;
    writeProjects(projects);
    res.json(updated);
  }
);

app.delete('/api/admin/projects/:id', requireAuth, async (req, res) => {
  const projects = await readProjects();
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = projects.splice(idx, 1);
  [removed.cover, ...(removed.images || [])].filter(Boolean).forEach(f => {
    if (!f.startsWith('http')) {
      const fp = path.join(UPLOADS_DIR, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  });
  writeProjects(projects);
  res.json({ ok: true });
});

app.post('/api/admin/projects/reorder', requireAuth, async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds must be array' });
  const projects = await readProjects();
  const map = Object.fromEntries(projects.map(p => [p.id, p]));
  writeProjects(orderedIds.map((id, i) => ({ ...map[id], order: i })).filter(Boolean));
  res.json({ ok: true });
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`\nâ Portfolio server: http://localhost:${PORT}`);
    console.log(`â Admin panel:      http://localhost:${PORT}/admin\n`);
  });
}

module.exports = app;
