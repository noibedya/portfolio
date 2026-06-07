const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ââ ADMIN PASSWORD (change this!) ââââââââââââââââââââââââââââââââââââââââââ
const ADMIN_PASSWORD = 'portfolio2025';

// ââ PATHS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const DATA_FILE    = path.join(__dirname, 'data', 'projects.json');
const UPLOADS_DIR  = path.join(__dirname, 'public', 'uploads');

// Ensure directories exist
[path.join(__dirname, 'data'), UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Seed empty projects file if missing
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

// ââ HELPERS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const readProjects  = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeProjects = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// ââ MULTER (file upload) âââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ MIDDLEWARE âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'noibedya-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ââ AUTH MIDDLEWARE ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ââ PUBLIC API âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

// GET all published projects (for the public portfolio)
app.get('/api/projects', (_req, res) => {
  const projects = readProjects().filter(p => p.published);
  res.json(projects.sort((a, b) => a.order - b.order || new Date(b.createdAt) - new Date(a.createdAt)));
});

// ââ ADMIN AUTH âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

app.get('/api/admin/check', (req, res) <> {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

// ââ ADMIN PROJECT API ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

// GET all projects (admin, includes drafts)
app.get('/api/admin/projects', requireAuth, (_req, res) => {
  const projects = readProjects();
  res.json(projects.sort((a, b) => a.order - b.order || new Date(b.createdAt) - new Date(a.createdAt)));
});

// POST create new project
app.post('/api/admin/projects',
  requireAuth,
  upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'images', maxCount: 20 }
  ]),
  (req, res) => {
    const projects = readProjects();
    const { title, category, description, summary, tags, tools, role, duration, link, published, featured, order } = req.body;

    const cover  = req.files?.cover?.[0]?.filename  || null;
    const images = (req.files?.images || []).map(f => f.filename);

    const project = {
      id:          uuidv4(),
      title:       title || 'Untitled',
      category:    category || '',
      summary:     summary || '',
      description: description || '',
      tags:        tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      tools:       tools ? tools.split(',').map(t => t.trim()).filter(Boolean) : [],
      role:        role || '',
      duration:    duration || '',
      link:        link || '',
      cover,
      images,
      published:   published === 'true' || published === true,
      featured:    featured === 'true' || featured === true,
      order:       parseInt(order) || projects.length,
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString()
    };

    projects.push(project);
    writeProjects(projects);
    res.status(201).json(project);
  }
);

// PUT update project
app.put('/api/admin/projects/:id',
  requireAuth,
  upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'images', maxCount: 20 }
  ]),
  (req, res) => {
    const projects = readProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const existing = projects[idx];
    const { title, category, description, summary, tags, tools, role, duration, link, published, featured, order, removeImages } = req.body;

    // Handle image removals
    let currentImages = [...(existing.images || [])];
    if (removeImages) {
      const toRemove = Array.isArray(removeImages) ? removeImages : [removeImages];
      toRemove.forEach(filename => {
        const filePath = path.join(UPLOADS_DIR, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        currentImages = currentImages.filter(f => f !== filename);
      });
    }

    // New cover
    const newCover = req.files?.cover?.[0]?.filename || null;
    if (newCover && existing.cover) {
      const oldPath = path.join(UPLOADS_DIR, existing.cover);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // New additional images
    const newImages = (req.files?.images || []).map(f => f.filename);

    const updated = {
      ...existing,
      title:       title       ?? existing.title,
      category:    category    ?? existing.category,
      summary:     summary     ?? existing.summary,
      description: description ?? existing.description,
      tags:        tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : existing.tags,
      tools:       tools ? tools.split(',').map(t => t.trim()).filter(Boolean) : existing.tools,
      role:        role        ?? existing.role,
      duration:    duration    ?? existing.duration,
      link:        link        ?? existing.link,
      cover:       newCover    || existing.cover,
      images:      [...currentImages, ...newImages],
      published:   published !== undefined ? (published === 'true' || published === true) : existing.published,
      featured:    featured  !== undefined ? (featured  === 'true' || featured  === true) : existing.featured,
      order:       order !== undefined ? parseInt(order) : existing.order,
      updatedAt:   new Date().toISOString()
    };

    projects[idx] = updated;
    writeProjects(projects);
    res.json(updated);
  }
);

// DELETE project
app.delete('/api/admin/projects/:id', requireAuth, (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  // Clean up files
  const proj = projects[idx];
  [proj.cover, ...(proj.images || [])].filter(Boolean).forEach(filename => {
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  projects.splice(idx, 1);
  writeProjects(projects);
  res.json({ success: true });
});

// PATCH reorder projects
app.patch('/api/admin/projects/reorder', requireAuth, (req, res) => {
  const { order } = req.body; // array of ids in new order
  const projects = readProjects();
  order.forEach((id, i) => {
    const proj = projects.find(p => p.id === id);
    if (proj) proj.order = i;
  });
  writeProjects(projects);
  res.json({ success: true });
});

// ââ CATCH ALL â index.html âââââââââââââââââââââââââââââââââââââââââââââââââ
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ââ START ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.listen(PORT, () => {
  console.log(`\nð  Portfolio running at http://localhost:${PORT}`);
  console.log(`ð  Admin panel at     http://localhost:${PORT}/admin.html`);
  console.log(`ð  Admin password:    ${ADMIN_PASSWORD}\n`);
});
