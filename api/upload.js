const { createHash } = require('node:crypto');
const { put } = require('@vercel/blob');
const { readBody, sendJson, storageReady, verifyAdmin } = require('./_lib');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const SUPPORTED_IMAGES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Metode permintaan tidak didukung.' });
    return;
  }

  try {
    const body = readBody(request);
    const admin = verifyAdmin(request, body);
    if (admin.error) {
      sendJson(response, admin.error.status, { error: admin.error.message });
      return;
    }
    if (!body || typeof body.image !== 'string' || !SUPPORTED_IMAGES.has(body.mime_type)) {
      sendJson(response, 415, { error: 'Format foto harus JPEG, PNG, atau WebP.' });
      return;
    }
    const encodedLength = body.image.length;
    if (!encodedLength || encodedLength > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) {
      sendJson(response, 413, { error: 'Ukuran foto setelah kompresi maksimal 3 MB.' });
      return;
    }
    const image = Buffer.from(body.image, 'base64');
    if (!image.length || image.length > MAX_IMAGE_BYTES) {
      sendJson(response, 413, { error: 'Ukuran foto setelah kompresi maksimal 3 MB.' });
      return;
    }
    const mimeType = SUPPORTED_IMAGES.get(body.mime_type);
    const expectedSignature = {
      'image/jpeg': image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff,
      'image/png': image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/webp': image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP'
    }[body.mime_type];
    if (!expectedSignature) {
      sendJson(response, 415, { error: 'Isi file tidak cocok dengan format gambar yang dikirim.' });
      return;
    }

    storageReady();
    const digest = createHash('sha256').update(image).digest('hex');
    const blob = await put(`cekkos/images/${digest}.${mimeType}`, image, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: body.mime_type,
      cacheControlMaxAge: 31536000
    });
    sendJson(response, 200, { success: true, path: blob.url, mime_type: body.mime_type });
  } catch (error) {
    console.error('Vercel CekKos image upload error:', error);
    sendJson(response, error.status || 500, {
      error: error.status ? error.message : `Foto gagal diunggah ke penyimpanan Vercel Blob${error.message ? `: ${error.message}` : '.'}`
    });
  }
};
