const { createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { list, put } = require('@vercel/blob');
const seedListings = require('../data/kos.json');

const DATABASE_PATH = 'cekkos/database/kos.json';
const MAX_LISTINGS = 1000;
const ALLOWED_TYPES = new Set(['Putra', 'Putri', 'Eksklusif', 'Campur']);

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }
  return null;
}

function equalSecret(left, right) {
  const leftHash = createHash('sha256').update(String(left)).digest();
  const rightHash = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function makeSession(username) {
  const secret = process.env.CEKKOS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Atur CEKKOS_SESSION_SECRET minimal 32 karakter pada Vercel.');
  const csrf = createHash('sha256').update(`${Date.now()}:${Math.random()}:${secret}`).digest('hex');
  const payload = Buffer.from(JSON.stringify({
    username,
    csrf,
    expires: Date.now() + 8 * 60 * 60 * 1000
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { value: `${payload}.${signature}`, csrf };
}

function getSession(request) {
  const secret = process.env.CEKKOS_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const cookieHeader = request.headers.cookie || '';
  const sessionCookie = cookieHeader.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('cekkos_session='));
  if (!sessionCookie) return null;
  let token;
  try {
    token = decodeURIComponent(sessionCookie.slice('cekkos_session='.length));
  } catch {
    return null;
  }
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!equalSecret(signature, expectedSignature)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.username || !decoded.csrf || !Number.isFinite(decoded.expires) || decoded.expires < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function setSessionCookie(response, value, maxAge) {
  response.setHeader('Set-Cookie', `cekkos_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
}

function verifyAdmin(request, body) {
  const session = getSession(request);
  if (!session) return { error: { status: 401, message: 'Sesi admin tidak aktif. Silakan login kembali.' } };
  const providedCsrf = request.headers['x-cekkos-csrf'] || (body && body.csrf_token);
  if (!providedCsrf || !equalSecret(providedCsrf, session.csrf)) {
    return { error: { status: 403, message: 'Token keamanan tidak valid. Muat ulang halaman dan coba kembali.' } };
  }
  return { session };
}

function storageReady() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const error = new Error('Penyimpanan Vercel Blob belum terhubung. Buat Blob Store dari dashboard Vercel dan hubungkan ke project ini.');
    error.status = 503;
    throw error;
  }
}

async function readListings() {
  storageReady();
  const blobs = await list({ prefix: DATABASE_PATH, limit: 1 });
  const databaseBlob = blobs.blobs.find((blob) => blob.pathname === DATABASE_PATH);
  if (!databaseBlob) return seedListings;
  const response = await fetch(`${databaseBlob.url}${databaseBlob.url.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Database JSON di Blob gagal dibaca (HTTP ${response.status}).`);
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('Data kost di Vercel Blob bukan array JSON.');
  return records;
}

function validateRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_LISTINGS) {
    throw Object.assign(new Error(`Data harus berupa array kost, maksimal ${MAX_LISTINGS} data.`), { status: 422 });
  }
  const ids = new Set();
  const names = new Set();
  const normalized = records.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw Object.assign(new Error('Format data kost tidak valid.'), { status: 422 });
    }
    const id = String(record.id ?? '').trim();
    const nama = String(record.nama_kos ?? '').trim();
    const tipe = String(record.tipe ?? '').trim();
    const harga = Number(record.harga);
    const lokasi = String(record.lokasi_singkat ?? '').trim();
    const mainImage = String(record.gambar_utama ?? '').trim();
    const gallery = record.galeri_foto;
    const facilities = record.fasilitas;
    const deskripsi = String(record.deskripsi ?? '').trim();
    const mapUrl = String(record.gmaps_url ?? '').trim();
    const phone = String(record.wa_number ?? '').replace(/\D/g, '');
    const isValidImage = (path) => typeof path === 'string'
      && path.length <= 2048
      && !path.includes('..')
      && (/^https:\/\//i.test(path) || /^assets\/images\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(path));

    if (!id || id.length > 80 || ids.has(id)) throw Object.assign(new Error('Setiap kost harus memiliki ID unik yang valid.'), { status: 422 });
    if (!nama || nama.length > 300 || !lokasi || lokasi.length > 500) throw Object.assign(new Error('Nama dan lokasi kost wajib diisi.'), { status: 422 });
    if (!ALLOWED_TYPES.has(tipe) || !Number.isSafeInteger(harga) || harga <= 0) throw Object.assign(new Error(`Harga atau tipe kost tidak valid: ${nama}`), { status: 422 });
    if (!isValidImage(mainImage) || !Array.isArray(gallery) || gallery.length < 1 || gallery.length > 30 || !gallery.every(isValidImage)) {
      throw Object.assign(new Error(`Path foto atau galeri tidak valid: ${nama}`), { status: 422 });
    }
    if (!gallery.includes(mainImage)) throw Object.assign(new Error(`Foto sampul harus terdaftar di galeri: ${nama}`), { status: 422 });
    if (!Array.isArray(facilities) || facilities.length > 50 || facilities.some((facility) => typeof facility !== 'string' || facility.length > 120)) {
      throw Object.assign(new Error(`Daftar fasilitas tidak valid: ${nama}`), { status: 422 });
    }
    let parsedMap;
    try {
      parsedMap = new URL(mapUrl);
    } catch {
      throw Object.assign(new Error(`URL Google Maps tidak valid: ${nama}`), { status: 422 });
    }
    if (!['http:', 'https:'].includes(parsedMap.protocol) || !deskripsi || deskripsi.length > 20000 || phone.length < 9 || phone.length > 15) {
      throw Object.assign(new Error(`Deskripsi, URL, atau nomor WhatsApp tidak valid: ${nama}`), { status: 422 });
    }
    ids.add(id);
    const normalizedName = nama.toLocaleLowerCase('id-ID');
    if (names.has(normalizedName)) throw Object.assign(new Error(`Nama kost duplikat: ${nama}`), { status: 422 });
    names.add(normalizedName);
    return {
      id,
      nama_kos: nama,
      tipe,
      harga,
      lokasi_singkat: lokasi,
      gambar_utama: mainImage,
      galeri_foto: [...new Set(gallery)],
      fasilitas: [...new Set(facilities.map((facility) => facility.trim()).filter(Boolean))],
      deskripsi,
      gmaps_url: parsedMap.href,
      wa_number: phone
    };
  });
  return normalized;
}

async function saveListings(records) {
  storageReady();
  const json = `${JSON.stringify(records, null, 2)}\n`;
  await put(DATABASE_PATH, json, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 0
  });
}

module.exports = {
  equalSecret,
  getSession,
  makeSession,
  readBody,
  readListings,
  saveListings,
  sendJson,
  setSessionCookie,
  storageReady,
  validateRecords,
  verifyAdmin
};
