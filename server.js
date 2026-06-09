'use strict';
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const cookieSession= require('cookie-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'portfolio2025';
const IS_VERCEL = !!process.env.VERCEL;
const DATA_FILE = IS_VERCEL ? '/tmp/projects.json' : path.join(__dirname, 'data', 'projects.json');
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'public', 'uploads');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUD_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET;
const DATA_PID = 'portfolio_data/projects';

[IS_VERCEL ? '/tmp' : path.join(__dirname, 'data'), UPLOADS_DIR].forEach(dir => {
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function cloudinaryFetch() {
if (!CLOUD_NAME) return null;
try {
const r = await fetch(`https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${DATA_PID}.json`,
{ headers: { 'Cache-Control': 'no-cache' } });
if (!r.ok) return null;
const data = await r.json();
return Array.isArray(data) ? data : null;
} catch { return null; }
}

async function cloudinaryPush(data) {
if (!CLOUD_NAME || !CLOUD_KEY || !CLOUD_SECRET) return;
const b64 = Buffer.from(JSON.stringify(data)).toString('base64');
const dataUri = `data:application/json;base64,${b64}`;
const ts = Math.round(Date.now() / 1000);
const sigStr = `invalidate=true&overwrite=true&public_id=${DATA_PID}&resource_type=raw&timestamp=${ts}`;
const sig = crypto.createHash('sha1').update(sigStr + CLOUD_SECRET).digest('hex');
const body = new URLSearchParams({ file: dataUri, api_key: CLOUD_KEY, timestamp: String(ts),
signature: sig, public_id: DATA_PID, overwrite: 'true', invalidate: 'true' });
try {
await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, { method: 'POST', body });
} catch(e) { console.error('Cloudinary push failed:', e.message); }
}

async function readProjects() {
if (fs.existsSync(DATA_FILE)) {
try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
}
if (IS_VERCEL) {
const cloud = await cloudinaryFetch();
if (cloud) { fs.writeFileSync(DATA_FILE, JSON.stringify(cloud, null, 2)); return cloud; }
}
const committed = path.join(__dirname, 'data', 'projects.json');
const seed = fs.existsSync(committed) ? fs.readFileSync(committed, 'utf8') : '[]';
fs.writeFileSync(DATA_FILE, seed);
return JSON.parse(seed);
}

function writeProjects(data) {
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
if (IS_VERCEL) cloudinaryPush(data);
}

const storage = multer.diskStorage({
destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
filename: (_req, file, cb) => {
const ext = path.extname(file.originalname).toLowerCase();
cb(null, `${Date.now()}-${uuidv4().slice(0,8)}${ext}`);
}
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
name: 'session', secret: process.env.SESSION_SECRET || 'noibedya-portfolio-secret-2025',
maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', secure: IS_VERCEL, httpOnly: true
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', (req, res, next) => {
const fp = path.join(UPLOADS_DIR, req.path.replace(/^\//, ''));
fs.existsSync(fp) ? res.sendFile(fp) : next();
});

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/project', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'project.html')));

const requireAuth = (req, res, next) => {
if (req.session && req.session.isAdmin) return next();
res.status(401).json({ error: 'Unauthorized' });
};

app.get('/api/projects', async (_req, res) => {
const projects = await readProjects();
res.json(projects.filter(p => p.published)
.sort((a,b) => (a.order||0)-(b.order||0) || new Date(b.createdAt)-new Date(a.createdAt)));
});

app.get('/api/projects/:id', async (req, res) => {
const projects = await readProjects();
const p = projects.find(p => p.id === req.params.id);
if (!p || !p.published) return res.status(404).json({ error: 'Not found' });
res.json(p);
});

app.post('/api/admin/login', (req, res) => {
const { password } = req.body;
if (password === ADMIN_PASSWORD) { req.session.isAdmin = true; res.json({ success: true }); }
else res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/admin/logout', (req, res) => { req.session = null; res.json({ success: true }); });

app.get('/api/admin/check', (req, res) => {
res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

app.post('/api/admin/cloudinary-sign', requireAuth, (req, res) => {
if (!CLOUD_NAME || !CLOUD_KEY || !CLOUD_SECRET)
return res.status(503).json({ error: 'Cloudinary not configured' });
const folder = 'portfolio_uploads';
const ts = Math.round(Date.now() / 1000);
const sigStr = `folder=${folder}&timestamp=${ts}${CLOUD_SECRET}`;
const sig = crypto.createHash('sha1').update(sigStr).digest('hex');
res.json({ timestamp: ts, signature: sig, apiKey: CLOUD_KEY, cloudName: CLOUD_NAME, folder });
});

app.get('/api/admin/projects', requireAuth, async (_req, res) => {
const projects = await readProjects();
res.json(projects.sort((a,b) => (a.order||0)-(b.order||0) || new Date(b.createdAt)-new Date(a.createdAt)));
});

function buildProject(req, existing = {}) {
const b = req.body;
let cover = existing.cover || null;
let images = [...(existing.images || [])];

if (b.coverUrl) cover = b.coverUrl;
else if (req.files?.cover?.[0]) cover = req.files.cover[0].filename;

if (b.removeImages) {
const rm = Array.isArray(b.removeImages) ? b.removeImages : [b.removeImages];
rm.forEach(f => {
images = images.filter(x => x !== f);
if (!f.startsWith('http')) { const fp = path.join(UPLOADS_DIR, f); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
});
}
if (b.imageUrls) { const u = Array.isArray(b.imageUrls) ? b.imageUrls : [b.imageUrls]; images.push(...u.filter(Boolean)); }
if (req.files?.images) images.push(...req.files.images.map(f => f.filename));

return {
title: b.title || existing.title || 'Untitled',
category: b.category ?? existing.category ?? '',
summary: b.summary ?? existing.summary ?? '',
description: b.description ?? existing.description ?? '',
tags: b.tags ? b.tags.split(',').map(t=>t.trim()).filter(Boolean) : (existing.tags || []),
tools: b.tools ? b.tools.split(',').map(t=>t.trim()).filter(Boolean) : (existing.tools || []),
role: b.role ?? existing.role ?? '',
duration: b.duration ?? existing.duration ?? '',
link: b.link ?? existing.link ?? '',
cover, images,
published: b.published !== undefined ? (b.published==='true'||b.published===true) : (existing.published||false),
featured: b.featured !== undefined ? (b.featured ==='true'||b.featured ===true) : (existing.featured ||false),
order: b.order !== undefined ? (parseInt(b.order)||0) : (existing.order||0)
};
}

app.post('/api/admin/projects', requireAuth,
upload.fields([{name:'cover',maxCount:1},{name:'images',maxCount:50}]),
async (req, res) => {
const projects = await readProjects();
const fields = buildProject(req, {});
const project = { id: uuidv4(), ...fields, order: fields.order||projects.length,
createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
projects.push(project);
writeProjects(projects);
res.status(201).json(project);
}
);

app.put('/api/admin/projects/:id', requireAuth,
upload.fields([{name:'cover',maxCount:1},{name:'images',maxCount:50}]),
async (req, res) => {
const projects = await readProjects();
const idx = projects.findIndex(p => p.id === req.params.id);
if (idx === -1) return res.status(404).json({ error: 'Not found' });
const existing = projects[idx];
if ((req.body.coverUrl || req.files?.cover?.[0]) && existing.cover && !existing.cover.startsWith('http')) {
const op = path.join(UPLOADS_DIR, existing.cover); if (fs.existsSync(op)) fs.unlinkSync(op);
}
const fields = buildProject(req, existing);
const updated = { ...existing, ...fields, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
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
[removed.cover, ...(removed.images||[])].filter(f=>f&&!f.startsWith('http')).forEach(f => {
const fp = path.join(UPLOADS_DIR, f); if (fs.existsSync(fp)) fs.unlinkSync(fp);
});
writeProjects(projects);
res.json({ ok: true });
});

app.post('/api/admin/projects/reorder', requireAuth, async (req, res) => {
const { orderedIds } = req.body;
if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds must be array' });
const projects = await readProjects();
const map = Object.fromEntries(projects.map(p=>[p.id,p]));
writeProjects(orderedIds.map((id,i)=>({...map[id],order:i})).filter(Boolean));
res.json({ ok: true });
});

if (!IS_VERCEL) app.listen(PORT, () => console.log(`Portfolio â http://localhost:${PORT}`));
module.exports = app;
