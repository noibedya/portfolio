const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// --- ADMIN PASSWORD ---
const ADMIN_PASSWORD = 'portfolio2025';

// --- PATHS (Vercel uses /tmp for writable storage) ---
const IS_VERCEL   = !!process.env.VERCEL;
const DATA_FILE   = IS_VERCEL ? '/tmp/projects.json' : path.join(__dirname, 'data', 'projects.json');
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads'       : path.join(__dirname, 'public', 'uploads');

// Ensure directories exist
[IS_VERCEL ? '/tmp' : path.join(__dirname, 'data'), UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Seed projects file
if (!fs.existsSync(DATA_FILE)) {
  const committed = path.join(__dirname, 'data', 'projects.json');
  const seed = fs.existsSync(committed) ? fs.readFileSync(committed, 'utf8') : '[]';
  fs.writeFileSync(DATA_FILE, seed);
}

// --- HELPERS ---
const readProjects  = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeProjects = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// --- MULTER ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb)  => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const fileFilter = (_req, file, cb) => {
  const allowed = [
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/quicktime','video/webm','video/avi','video/mov',
    'application/pdf'
  ];
  cb(null, allowed.includes(file.mimetype));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } });

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: 'portfolio-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Admin route
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- AUTH ---
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// --- CLOUDINARY SIGN ---
app.post('/api/admin/cloudinary-sign', requireAuth, (req, res) => {
  const cloud  = process.env.CLOUDINARY_CLOUD_NAME;
  const key    = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) {
    return res.status(503).json({ error: 'Cloudinary not configured' });
  }
  const timestamp = Math.round(Date.now() / 1000);
  const folder    = 'portfolio';
  const str = `folder=${folder}&timestamp=${timestamp}${secret}`;
  const signature = crypto.createHash('sha1').update(str).digest('hex');
  res.json({ timestamp, signature, apiKey: key, cloudName: cloud, folder });
});

// --- PROJECTS API ---
app.get('/api/projects', (_req, res) => {
  try {
    res.json(readProjects());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/projects', requireAuth, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'images', maxCount: 20 }
]), (req, res) => {
  try {
    const projects = readProjects();
    const { title, slug, category, description, longDescription,
            tools, year, link, featured, coverUrl, imageUrls } = req.body;

    const coverFile  = req.files && req.files['cover']  ? req.files['cover'][0]  : null;
    const imageFiles = req.files && req.files['images'] ? req.files['images']    : [];

    let cover = coverUrl || '';
    if (coverFile) cover = `/uploads/${coverFile.filename}`;

    let images = [];
    if (imageUrls) {
      images = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
    }
    imageFiles.forEach(f => images.push(`/uploads/${f.filename}`));

    const project = {
      id: uuidv4(),
      title: title || '',
      slug: slug || (title ? title.toLowerCase().replace(/\s+/g, '-') : ''),
      category: category || '',
      description: description || '',
      longDescription: longDescription || '',
      tools: tools ? (typeof tools === 'string' ? tools.split(',').map(t => t.trim()) : tools) : [],
      year: year || new Date().getFullYear().toString(),
      link: link || '',
      featured: featured === 'true' || featured === true,
      cover,
      images,
      createdAt: new Date().toISOString()
    };

    projects.push(project);
    writeProjects(projects);
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/projects/:id', requireAuth, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'images', maxCount: 20 }
]), (req, res) => {
  try {
    const projects = readProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const { title, slug, category, description, longDescription,
            tools, year, link, featured, coverUrl, imageUrls, removedImages } = req.body;

    const coverFile  = req.files && req.files['cover']  ? req.files['cover'][0]  : null;
    const imageFiles = req.files && req.files['images'] ? req.files['images']    : [];
    const existing   = projects[idx];

    let cover = existing.cover;
    if (coverUrl)  cover = coverUrl;
    if (coverFile) cover = `/uploads/${coverFile.filename}`;

    let images = existing.images || [];
    if (removedImages) {
      const removed = Array.isArray(removedImages) ? removedImages : [removedImages];
      images = images.filter(img => !removed.includes(img));
    }
    if (imageUrls) {
      const newUrls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
      images = [...images, ...newUrls];
    }
    imageFiles.forEach(f => images.push(`/uploads/${f.filename}`));

    projects[idx] = {
      ...existing,
      title:           title           !== undefined ? title           : existing.title,
      slug:            slug            !== undefined ? slug            : existing.slug,
      category:        category        !== undefined ? category        : existing.category,
      description:     description     !== undefined ? description     : existing.description,
      longDescription: longDescription !== undefined ? longDescription : existing.longDescription,
      tools: tools ? (typeof tools === 'string' ? tools.split(',').map(t => t.trim()) : tools) : existing.tools,
      year:     year     !== undefined ? year     : existing.year,
      link:     link     !== undefined ? link     : existing.link,
      featured: featured !== undefined ? (featured === 'true' || featured === true) : existing.featured,
      cover,
      images,
      updatedAt: new Date().toISOString()
    };

    writeProjects(projects);
    res.json(projects[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/projects/:id', requireAuth, (req, res) => {
  try {
    const projects = readProjects();
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const project = projects[idx];
    const filesToDelete = [project.cover, ...(project.images || [])].filter(Boolean);
    filesToDelete.forEach(f => {
      if (!f.startsWith('http')) {
        const fp = path.join(__dirname, 'public', f);
        if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (_) {} }
      }
    });

    projects.splice(idx, 1);
    writeProjects(projects);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- START ---
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
