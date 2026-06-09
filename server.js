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
