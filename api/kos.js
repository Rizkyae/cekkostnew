const {
  equalSecret,
  getSession,
  makeSession,
  readBody,
  readListings,
  saveListings,
  sendJson,
  setSessionCookie,
  validateRecords,
  verifyAdmin
} = require('./_lib');

module.exports = async function handler(request, response) {
  try {
    const method = request.method || 'GET';
    const action = new URL(request.url, 'https://cekkos.invalid').searchParams.get('action') || '';

    if (method === 'GET' && action === 'session') {
      const session = getSession(request);
      sendJson(response, 200, { authenticated: Boolean(session), csrf_token: session ? session.csrf : null });
      return;
    }
    if (method === 'GET') {
      sendJson(response, 200, await readListings());
      return;
    }
    if (method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      sendJson(response, 405, { error: 'Metode permintaan tidak didukung.' });
      return;
    }

    const body = readBody(request);
    if (!body || typeof body !== 'object') {
      sendJson(response, 400, { error: 'Permintaan JSON tidak valid.' });
      return;
    }

    if (body.action === 'login') {
      const username = process.env.CEKKOS_ADMIN_USERNAME;
      const password = process.env.CEKKOS_ADMIN_PASSWORD;
      const sessionSecret = process.env.CEKKOS_SESSION_SECRET;
      if (!username || !password || !sessionSecret || sessionSecret.length < 32) {
        sendJson(response, 503, { error: 'Login belum dikonfigurasi. Tambahkan CEKKOS_ADMIN_USERNAME, CEKKOS_ADMIN_PASSWORD, dan CEKKOS_SESSION_SECRET di Vercel → Settings → Environment Variables.' });
        return;
      }
      if (!equalSecret(body.username || '', username) || !equalSecret(body.password || '', password)) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        sendJson(response, 401, { error: 'Username atau password salah.' });
        return;
      }
      const session = makeSession(username);
      setSessionCookie(response, session.value, 8 * 60 * 60);
      sendJson(response, 200, { authenticated: true, csrf_token: session.csrf });
      return;
    }

    const admin = verifyAdmin(request, body);
    if (admin.error) {
      sendJson(response, admin.error.status, { error: admin.error.message });
      return;
    }

    if (body.action === 'logout') {
      setSessionCookie(response, '', 0);
      sendJson(response, 200, { authenticated: false });
      return;
    }
    if (body.action !== 'save') {
      sendJson(response, 400, { error: 'Aksi API tidak dikenal.' });
      return;
    }
    if (!Array.isArray(body.data)) {
      sendJson(response, 400, { error: 'Data kost harus berupa array.' });
      return;
    }

    const records = validateRecords(body.data);
    await saveListings(records);
    sendJson(response, 200, { success: true, count: records.length, data: records });
  } catch (error) {
    console.error('Vercel CekKos API error:', error);
    sendJson(response, error.status || 500, {
      error: error.status ? error.message : `Server gagal memproses permintaan${error.message ? `: ${error.message}` : '.'}`
    });
  }
};
