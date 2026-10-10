(() => {
  'use strict';

  const IS_LOCAL_PHP_HOST = /^(localhost|127(?:\.\d{1,3}){3}|::1|.*\.(?:test|local))$/i.test(window.location.hostname)
    && !['3000', '3001', '5173'].includes(window.location.port);
  const API_URL = IS_LOCAL_PHP_HOST ? 'laragon-api/kos.php' : '/api/kos';
  const UPLOAD_URL = IS_LOCAL_PHP_HOST ? 'laragon-api/upload.php' : '/api/upload';
  const LEGACY_STORAGE_KEY = 'cekkos_kos_data_v1';
  const DEFAULT_IMAGE = 'assets/images/kos-1.jpg';
  let csrfToken = '';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  const formatPrice = (price) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(price) || 0);

  function normalizeListing(item) {
    const mainImage = String(item.gambar_utama || item.mainImage || DEFAULT_IMAGE);
    const gallery = Array.isArray(item.galeri_foto)
      ? item.galeri_foto
      : Array.isArray(item.images) ? item.images : [];
    return {
      id: String(item.id ?? ''),
      nama_kos: String(item.nama_kos || item.name || ''),
      tipe: String(item.tipe || item.type || 'Campur'),
      harga: Number(item.harga ?? item.price) || 0,
      lokasi_singkat: String(item.lokasi_singkat || item.location || ''),
      gambar_utama: mainImage,
      galeri_foto: [...new Set([mainImage, ...gallery.map(String)].filter(Boolean))],
      fasilitas: Array.isArray(item.fasilitas) ? item.fasilitas.map(String) : Array.isArray(item.facilities) ? item.facilities.map(String) : [],
      deskripsi: String(item.deskripsi || item.description || ''),
      gmaps_url: String(item.gmaps_url || ''),
      wa_number: String(item.wa_number || '6281234567890')
    };
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('File yang dipilih bukan gambar.'));
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        reject(new Error('Ukuran gambar maksimal 15 MB sebelum kompresi.'));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const maxDimension = 1440;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Browser tidak dapat memproses gambar.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Gambar gagal dikompres.'));
            return;
          }
          resolve(blob);
        }, 'image/jpeg', 0.78);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('File yang dipilih tidak dapat dibuka sebagai gambar.'));
      };
      image.src = objectUrl;
    });
  }

  async function apiRequest(action, data, method = 'POST') {
    const options = {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {}
    };
    if (method !== 'GET') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ action, ...data, csrf_token: csrfToken });
    }
    const response = await fetch(method === 'GET' ? `${API_URL}?action=${encodeURIComponent(action)}` : API_URL, options);
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result && result.error ? result.error : `Permintaan ke server gagal (HTTP ${response.status}).`);
    return result;
  }

  async function uploadImage(file) {
    const compressedImage = await compressImage(file);
    if (compressedImage.size > (IS_LOCAL_PHP_HOST ? 8 : 3) * 1024 * 1024) throw new Error('Foto terlalu besar setelah dikompres. Pilih foto lain.');
    if (IS_LOCAL_PHP_HOST) {
      const formData = new FormData();
      formData.append('image', compressedImage, 'kost.jpg');
      const localResponse = await fetch(UPLOAD_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CekKos-CSRF': csrfToken },
        body: formData
      });
      const localResult = await localResponse.json().catch(() => null);
      if (!localResponse.ok) throw new Error(localResult && localResult.error ? localResult.error : `Upload gambar gagal (HTTP ${localResponse.status}).`);
      if (!localResult || typeof localResult.path !== 'string') throw new Error('Server tidak mengembalikan path foto.');
      return localResult.path;
    }

    const bytes = new Uint8Array(await compressedImage.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    const imageBase64 = btoa(binary);
    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CekKos-CSRF': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mime_type: 'image/jpeg' })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result && result.error ? result.error : `Upload gambar gagal (HTTP ${response.status}).`);
    if (!result || typeof result.path !== 'string') throw new Error('Server tidak mengembalikan path foto.');
    return result.path;
  }

  function showNotice(message, kind) {
    const notice = document.getElementById('admin-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.className = `admin-notice is-${kind || 'info'}`;
    notice.hidden = false;
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setupLogin() {
    const form = document.getElementById('admin-login-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      const message = document.getElementById('login-message');
      const values = new FormData(form);
      submitButton.disabled = true;
      message.textContent = '';

      try {
        const result = await apiRequest('login', {
          username: String(values.get('username') || '').trim(),
          password: String(values.get('password') || '')
        });
        csrfToken = result.csrf_token;
        window.location.assign('admin-dashboard.html');
      } catch (error) {
        console.error('Login admin gagal:', error);
        message.textContent = error.message;
        message.className = 'form-message is-error';
        window.alert(error.message);
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  async function setupDashboard() {
    const dashboard = document.querySelector('[data-admin-dashboard]');
    if (!dashboard) return;

    const form = document.getElementById('kost-form');
    const list = document.getElementById('admin-kost-list');
    const editor = document.getElementById('kost-editor');
    const editorTitle = document.getElementById('editor-title');
    const sourceLabel = document.getElementById('admin-data-source');
    const emptyState = document.getElementById('admin-empty');
    const galleryUpload = document.getElementById('gallery-upload');
    const galleryPreview = document.getElementById('image-gallery');
    const galleryEmpty = document.getElementById('image-gallery-empty');
    const importButton = document.getElementById('import-local-data');
    let listings = [];
    let galleryImages = [];
    let selectedMainImage = '';

    try {
      const session = await apiRequest('session', null, 'GET');
      if (!session.authenticated) {
        window.location.replace('admin-login.html');
        return;
      }
      csrfToken = session.csrf_token;

      const dataResponse = await fetch(API_URL, { credentials: 'same-origin', cache: 'no-store' });
      const data = await dataResponse.json().catch(() => null);
      if (!dataResponse.ok || !Array.isArray(data)) {
        throw new Error(data && data.error ? data.error : 'Data kost dari server tidak valid.');
      }
      listings = data.map(normalizeListing);
      sourceLabel.textContent = 'Sumber aktif: database JSON di server. Perubahan tersinkron untuk semua perangkat.';
      renderListings();
      checkLegacyData();
    } catch (error) {
      console.error('Gagal menyiapkan dashboard admin:', error);
      showNotice(`Dashboard gagal memuat data dari server. Pastikan API hosting, sesi login, dan database tersedia. ${error.message}`, 'error');
      sourceLabel.textContent = 'Server/API tidak dapat diakses.';
      emptyState.hidden = false;
      list.closest('table').hidden = true;
      if (/401|sesi admin/i.test(error.message)) window.location.replace('admin-login.html');
      return;
    }

    function renderListings() {
      list.innerHTML = listings.map((item) => `
        <tr>
          <td><div class="admin-kost-name"><img src="${escapeHtml(item.gambar_utama)}" alt="" loading="lazy"><span><strong>${escapeHtml(item.nama_kos)}</strong><small>${escapeHtml(item.lokasi_singkat)}</small></span></div></td>
          <td>${formatPrice(item.harga)}</td>
          <td><span class="kost-tag">${escapeHtml(item.tipe)}</span></td>
          <td><div class="row-actions"><button class="row-action" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">Edit</button><button class="row-action is-delete" type="button" data-action="delete" data-id="${escapeHtml(item.id)}">Hapus</button></div></td>
        </tr>`).join('');
      document.getElementById('total-listings').textContent = String(listings.length);
      emptyState.hidden = listings.length > 0;
      list.closest('table').hidden = listings.length === 0;
    }

    function syncFormImages() {
      form.elements.gambar_utama.value = selectedMainImage;
      form.elements.galeri_foto.value = JSON.stringify(galleryImages);
    }

    function renderGallery() {
      galleryPreview.innerHTML = galleryImages.map((image, index) => {
        const isCover = image === selectedMainImage;
        return `
          <article class="admin-image-card ${isCover ? 'is-cover' : ''}">
            <button class="admin-image-select" type="button" data-image-index="${index}" aria-pressed="${isCover}" aria-label="${isCover ? 'Foto sampul' : 'Jadikan foto sampul'}">
              <img src="${escapeHtml(image)}" alt="Foto kost ${index + 1}" loading="lazy">
              <span class="cover-label">${isCover ? 'Foto sampul' : 'Pilih sampul'}</span>
            </button>
            <button class="admin-image-remove" type="button" data-remove-index="${index}" aria-label="Hapus foto ${index + 1}">&times;</button>
          </article>`;
      }).join('');
      galleryEmpty.hidden = galleryImages.length > 0;
      syncFormImages();
    }

    function clearForm() {
      form.reset();
      form.elements.id.value = '';
      galleryImages = [];
      selectedMainImage = '';
      galleryUpload.value = '';
      renderGallery();
      editorTitle.textContent = 'Tambah kost baru';
      document.getElementById('save-kost').textContent = 'Simpan kost';
    }

    function beginEdit(id) {
      const item = listings.find((listing) => listing.id === id);
      if (!item) {
        showNotice('Data kost yang akan diedit tidak ditemukan.', 'error');
        return;
      }
      clearForm();
      form.elements.id.value = item.id;
      form.elements.nama_kos.value = item.nama_kos;
      form.elements.tipe.value = item.tipe;
      form.elements.harga.value = item.harga;
      form.elements.lokasi_singkat.value = item.lokasi_singkat;
      galleryImages = [...new Set([item.gambar_utama, ...item.galeri_foto].filter(Boolean))];
      selectedMainImage = item.gambar_utama;
      renderGallery();
      form.elements.deskripsi.value = item.deskripsi;
      form.elements.gmaps_url.value = item.gmaps_url;
      form.elements.wa_number.value = item.wa_number;

      const knownFacilities = [];
      form.querySelectorAll('input[name="fasilitas"]').forEach((checkbox) => {
        checkbox.checked = item.fasilitas.includes(checkbox.value);
        if (checkbox.checked) knownFacilities.push(checkbox.value);
      });
      form.elements.fasilitas_tambahan.value = item.fasilitas.filter((facility) => !knownFacilities.includes(facility)).join(', ');
      editorTitle.textContent = 'Edit data kost';
      document.getElementById('save-kost').textContent = 'Simpan perubahan';
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function saveListings(nextListings) {
      const result = await apiRequest('save', { data: nextListings });
      if (!result || !Array.isArray(result.data)) throw new Error('Server tidak mengembalikan data kost yang tersimpan.');
      listings = result.data.map(normalizeListing);
      renderListings();
    }

    async function migrateLegacyData() {
      let oldRecords;
      try {
        oldRecords = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
      } catch (error) {
        throw new Error(`Data lama di browser tidak dapat dibaca: ${error.message}`);
      }
      if (!Array.isArray(oldRecords) || oldRecords.length === 0) throw new Error('Tidak ada data lama di browser untuk diimpor.');

      const uploadedPaths = new Map();
      async function convertImage(path) {
        if (!path.startsWith('data:image/')) return path;
        if (uploadedPaths.has(path)) return uploadedPaths.get(path);
        const imageBlob = await fetch(path).then((response) => {
          if (!response.ok) throw new Error('Foto lama tidak dapat dibaca.');
          return response.blob();
        });
        const serverPath = await uploadImage(imageBlob);
        uploadedPaths.set(path, serverPath);
        return serverPath;
      }

      const migrated = [];
      for (const rawRecord of oldRecords) {
        const record = normalizeListing(rawRecord);
        record.gambar_utama = await convertImage(record.gambar_utama);
        record.galeri_foto = [...new Set(await Promise.all(record.galeri_foto.map(convertImage)))];
        if (!record.galeri_foto.includes(record.gambar_utama)) record.galeri_foto.unshift(record.gambar_utama);
        if (!/^https:\/\//i.test(record.gambar_utama) && !/^assets\/images\//i.test(record.gambar_utama)) {
          throw new Error(`Path gambar lama untuk "${record.nama_kos}" tidak dikenal dan tidak bisa dimigrasikan.`);
        }
        migrated.push(record);
      }
      await saveListings(migrated);
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (error) {
        console.warn('Data lama berhasil dipindahkan tetapi cache lokal tidak dapat dihapus:', error);
      }
      importButton.hidden = true;
      showNotice(`${migrated.length} kost lama berhasil dipindahkan ke server dan kini dapat dilihat di perangkat lain.`, 'success');
    }

    function checkLegacyData() {
      try {
        const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!saved) return;
        const oldData = JSON.parse(saved);
        if (Array.isArray(oldData) && oldData.length) importButton.hidden = false;
      } catch (error) {
        console.error('Data lokal lama tidak valid:', error);
        showNotice('Data kost lama di browser tidak dapat dibaca. Data server tetap aman.', 'error');
      }
    }

    document.getElementById('admin-logout').addEventListener('click', async () => {
      try {
        await apiRequest('logout', {});
      } catch (error) {
        console.error('Logout server gagal:', error);
      } finally {
        window.location.assign('admin-login.html');
      }
    });

    document.getElementById('new-kost').addEventListener('click', () => {
      clearForm();
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.elements.nama_kos.focus();
    });
    document.getElementById('cancel-edit').addEventListener('click', clearForm);
    document.getElementById('cancel-form').addEventListener('click', clearForm);

    galleryUpload.addEventListener('change', async () => {
      const files = Array.from(galleryUpload.files || []);
      if (!files.length) return;
      const uploadButton = document.querySelector('.image-upload-button');
      uploadButton.classList.add('is-loading');
      try {
        let added = 0;
        for (const file of files) {
          const path = await uploadImage(file);
          if (galleryImages.includes(path)) continue;
          galleryImages.push(path);
          if (!selectedMainImage) selectedMainImage = path;
          added += 1;
          renderGallery();
        }
        showNotice(added ? `${added} foto berhasil diunggah ke server dan siap dipakai.` : 'Foto yang sama sudah ada di galeri, tidak ditambahkan lagi.', added ? 'success' : 'info');
      } catch (error) {
        console.error('Gagal mengunggah gambar kost:', error);
        showNotice(error.message, 'error');
      } finally {
        uploadButton.classList.remove('is-loading');
        galleryUpload.value = '';
      }
    });

    galleryPreview.addEventListener('click', (event) => {
      const removeButton = event.target.closest('button[data-remove-index]');
      if (removeButton) {
        const index = Number(removeButton.dataset.removeIndex);
        if (!Number.isInteger(index) || index < 0 || index >= galleryImages.length) return;
        const [removedImage] = galleryImages.splice(index, 1);
        if (selectedMainImage === removedImage) selectedMainImage = galleryImages[0] || '';
        renderGallery();
        return;
      }
      const selectButton = event.target.closest('button[data-image-index]');
      if (!selectButton) return;
      const index = Number(selectButton.dataset.imageIndex);
      if (!Number.isInteger(index) || index < 0 || index >= galleryImages.length) return;
      selectedMainImage = galleryImages[index];
      renderGallery();
    });

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'edit') {
        beginEdit(button.dataset.id);
        return;
      }
      const item = listings.find((listing) => listing.id === button.dataset.id);
      if (!item || !window.confirm(`Hapus "${item.nama_kos}" dari katalog?`)) return;
      const nextListings = listings.filter((listing) => listing.id !== item.id);
      try {
        await saveListings(nextListings);
        showNotice(`${item.nama_kos} berhasil dihapus dari database server.`, 'success');
      } catch (error) {
        console.error('Gagal menghapus kost:', error);
        showNotice(`Kost tidak dihapus dari server: ${error.message}`, 'error');
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const saveButton = document.getElementById('save-kost');
      const formData = new FormData(form);
      const existingId = String(formData.get('id') || '');
      const name = String(formData.get('nama_kos') || '').trim();
      const image = selectedMainImage;
      const mapUrl = String(formData.get('gmaps_url') || '').trim();
      const phone = String(formData.get('wa_number') || '').replace(/\D/g, '');

      if (!image || !galleryImages.includes(image)) {
        showNotice('Unggah minimal satu foto dari perangkat dan tentukan foto sampul.', 'error');
        galleryUpload.focus();
        return;
      }
      let parsedMap;
      try {
        parsedMap = new URL(mapUrl);
      } catch {
        showNotice('Link Google Maps harus berupa URL yang valid.', 'error');
        form.elements.gmaps_url.focus();
        return;
      }
      if (!['http:', 'https:'].includes(parsedMap.protocol)) {
        showNotice('Link Google Maps harus menggunakan HTTP atau HTTPS.', 'error');
        form.elements.gmaps_url.focus();
        return;
      }

      const facilities = [
        ...formData.getAll('fasilitas').map(String),
        ...String(formData.get('fasilitas_tambahan') || '').split(',').map((facility) => facility.trim()).filter(Boolean)
      ].filter((facility, index, items) => items.indexOf(facility) === index);
      const listing = {
        id: existingId || createId(),
        nama_kos: name,
        tipe: String(formData.get('tipe') || 'Campur'),
        harga: Number(formData.get('harga')),
        lokasi_singkat: String(formData.get('lokasi_singkat') || '').trim(),
        gambar_utama: image,
        galeri_foto: [...new Set(galleryImages)],
        fasilitas: facilities,
        deskripsi: String(formData.get('deskripsi') || '').trim(),
        gmaps_url: parsedMap.href,
        wa_number: phone
      };
      if (listings.some((item) => item.id !== existingId && item.nama_kos.toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID'))) {
        showNotice('Nama kost tersebut sudah terdaftar. Gunakan nama yang berbeda.', 'error');
        form.elements.nama_kos.focus();
        return;
      }

      const nextListings = existingId
        ? listings.map((item) => item.id === existingId ? listing : item)
        : [listing, ...listings];
      saveButton.disabled = true;
      try {
        await saveListings(nextListings);
        clearForm();
        showNotice(existingId ? 'Perubahan kost tersimpan di server dan kini sinkron untuk semua perangkat.' : 'Kost baru tersimpan di server dan kini tampil untuk semua perangkat.', 'success');
      } catch (error) {
        console.error('Gagal menyimpan kost:', error);
        showNotice(`Perubahan tidak tersimpan ke server: ${error.message}`, 'error');
      } finally {
        saveButton.disabled = false;
      }
    });

    importButton.addEventListener('click', async () => {
      if (!window.confirm('Impor seluruh data lama dari browser ini dan mengganti katalog bersama di server? Foto lama juga akan diunggah. Data server yang ada akan diganti.')) return;
      importButton.disabled = true;
      try {
        await migrateLegacyData();
      } catch (error) {
        console.error('Migrasi data lokal gagal:', error);
        showNotice(`Data lokal belum berhasil dipindahkan. Data server tidak diganti. ${error.message}`, 'error');
      } finally {
        importButton.disabled = false;
      }
    });

    document.getElementById('export-json').addEventListener('click', async () => {
      try {
        const response = await fetch(API_URL, { credentials: 'same-origin', cache: 'no-store' });
        const latestData = await response.json();
        if (!response.ok || !Array.isArray(latestData)) throw new Error('Data terbaru dari server tidak dapat dibaca.');
        listings = latestData.map(normalizeListing);
        renderListings();
        const blob = new Blob([`${JSON.stringify(listings, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const download = document.createElement('a');
        download.href = url;
        download.download = 'kos.json';
        document.body.appendChild(download);
        download.click();
        download.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showNotice('Database terbaru berhasil diekspor sebagai kos.json.', 'success');
      } catch (error) {
        console.error('Gagal mengekspor data kost:', error);
        showNotice(`Ekspor JSON gagal: ${error.message}`, 'error');
      }
    });

    function createId() {
      const numericIds = listings.map((item) => Number(item.id)).filter(Number.isFinite);
      return String(Math.max(0, ...numericIds) + 1);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupLogin();
    setupDashboard();
  });
})();
