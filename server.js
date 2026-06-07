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
const DATA_FILE   = IS_VERCEL ? '/tmp/projects.json'  : path.join(__dirname, 'data', 'projects.json');
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads'        : path.join(__dirname, 'public', 'uploads');


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

