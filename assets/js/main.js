(() => {
  'use strict';

  const DATA_URL = 'data/kos.json';
  const IS_LOCAL_PHP_HOST = /^(localhost|127(?:\.\d{1,3}){3}|::1|.*\.(?:test|local))$/i.test(window.location.hostname)
    && !['3000', '3001', '5173'].includes(window.location.port);
  const API_URL = IS_LOCAL_PHP_HOST ? 'laragon-api/kos.php' : '/api/kos';
  const FALLBACK_IMAGE = 'assets/images/kos-1.jpg';
  const FACILITY_ICONS = {
    'AC': '❄',
    'Wi-Fi cepat': '⌁',
    'WiFi': '⌁',
    'Kamar mandi dalam': '♨',
    'Kasur springbed': '▤',
    'Kasur': '▤',
    'Springbed': '▤',
    'Lemari pakaian': '▥',
    'Parkir luas': '▱',
    'CCTV 24 jam': '◉',
    'Dapur bersama': '⌂',
    'Akses 24 jam': '◷',
    'Area jemur': '☼',
    'Ruang komunal': '▦'
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  const formatPrice = (price) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(price) || 0);

  function normalizeListing(item) {
    const gallery = Array.isArray(item.galeri_foto) ? item.galeri_foto : [];
    const mainImage = item.gambar_utama || FALLBACK_IMAGE;
    return {
      id: String(item.id ?? ''),
      nama_kos: String(item.nama_kos || item.name || 'Kost tanpa nama'),
      tipe: String(item.tipe || item.type || 'Campur'),
      harga: Number(item.harga ?? item.price) || 0,
      lokasi_singkat: String(item.lokasi_singkat || item.location || ''),
      gambar_utama: String(mainImage),
      galeri_foto: gallery.length ? gallery.map(String) : [String(mainImage)],
      fasilitas: Array.isArray(item.fasilitas) ? item.fasilitas.map(String) : (Array.isArray(item.facilities) ? item.facilities.map(String) : []),
      deskripsi: String(item.deskripsi || item.description || ''),
      gmaps_url: String(item.gmaps_url || ''),
      wa_number: String(item.wa_number || '6281234567890')
    };
  }

  function safeImagePath(path) {
    const value = String(path || '').trim();
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)) return value;
    if (/^(?:https?:\/\/|\/|\.\/|assets\/images\/)[^\s"'<>]+$/i.test(value)) return value;
    return FALLBACK_IMAGE;
  }

  function safeExternalUrl(value, fallback) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  async function loadListings() {
    try {
      const response = await fetch(API_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`API gagal dibaca (HTTP ${response.status}).`);
      const parsedData = await response.json();
      if (!Array.isArray(parsedData)) throw new Error('Format respons API kost harus berupa array.');
      return { listings: parsedData.map(normalizeListing), source: 'server' };
    } catch (error) {
      console.warn('API kost tidak tersedia, memakai database JSON lokal:', error);
    }

    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`File ${DATA_URL} gagal dibaca (HTTP ${response.status}).`);
    const parsedData = await response.json();
    if (!Array.isArray(parsedData)) throw new Error('Format data/kos.json harus berupa array.');
    return { listings: parsedData.map(normalizeListing), source: 'data/kos.json' };
  }

  function setupMenu() {
    const toggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.site-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('is-open', !open);
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'false');
      nav.classList.remove('is-open');
    }));
  }

  async function setupCatalog() {
    const grid = document.getElementById('kost-grid');
    if (!grid) return;

    const searchForm = document.getElementById('search-form');
    const locationInput = document.getElementById('location-search');
    const typeInput = document.getElementById('type-search');
    const count = document.getElementById('result-count');
    const emptyState = document.getElementById('empty-state');
    let selectedCategory = 'Semua';
    let listings = [];

    try {
      const loaded = await loadListings();
      listings = loaded.listings;
      render();
    } catch (error) {
      console.error('Gagal memuat katalog kost:', error);
      count.textContent = 'Katalog belum dapat dimuat.';
      grid.hidden = true;
      emptyState.hidden = false;
      emptyState.querySelector('h3').textContent = 'Data kost belum dapat dimuat';
      emptyState.querySelector('p').textContent = 'API katalog tidak tersedia. Pastikan endpoint server aktif atau file data/kos.json dapat dibaca.';
      const resetButton = document.getElementById('reset-search');
      if (resetButton) resetButton.hidden = true;
      return;
    }

    function render() {
      const location = locationInput.value.trim().toLocaleLowerCase('id-ID');
      const type = typeInput.value;
      const results = listings.filter((item) => {
        const searchable = `${item.nama_kos} ${item.lokasi_singkat}`.toLocaleLowerCase('id-ID');
        return (!location || searchable.includes(location))
          && (!type || item.tipe === type)
          && (selectedCategory === 'Semua' || item.tipe === selectedCategory);
      });

      grid.innerHTML = results.map((item) => {
        const image = safeImagePath(item.gambar_utama);
        const detailUrl = `detail-kos.html?id=${encodeURIComponent(item.id)}`;
        return `
          <article class="kost-card">
            <a class="kost-card-image" href="${detailUrl}" aria-label="Lihat detail ${escapeHtml(item.nama_kos)}">
              <img src="${escapeHtml(image)}" alt="Foto ${escapeHtml(item.nama_kos)}" loading="lazy">
              <span class="kost-tag">Kost ${escapeHtml(item.tipe)}</span>
            </a>
            <div class="kost-card-content">
              <h3>${escapeHtml(item.nama_kos)}</h3>
              <p class="kost-location"><span aria-hidden="true">⌖</span>${escapeHtml(item.lokasi_singkat)}</p>
              <div class="facility-preview">${item.fasilitas.slice(0, 3).map((facility) => `<span>${escapeHtml(facility)}</span>`).join('')}</div>
              <div class="kost-card-footer">
                <span class="kost-price">${formatPrice(item.harga)} <small>/ bulan</small></span>
                <a class="detail-link" href="${detailUrl}">Lihat Detail</a>
              </div>
            </div>
          </article>`;
      }).join('');

      count.textContent = `Menampilkan ${results.length} dari ${listings.length} kost`;
      emptyState.hidden = results.length > 0;
      grid.hidden = results.length === 0;
    }

    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      selectedCategory = 'Semua';
      document.querySelectorAll('.category-chip').forEach((chip) => chip.classList.toggle('is-active', chip.dataset.category === 'Semua'));
      render();
      document.getElementById('katalog').scrollIntoView({ behavior: 'smooth' });
    });
    document.querySelectorAll('.category-chip').forEach((chip) => chip.addEventListener('click', () => {
      selectedCategory = chip.dataset.category;
      document.querySelectorAll('.category-chip').forEach((button) => button.classList.toggle('is-active', button === chip));
      render();
    }));

    const clearSearch = () => {
      locationInput.value = '';
      typeInput.value = '';
      selectedCategory = 'Semua';
      document.querySelectorAll('.category-chip').forEach((chip) => chip.classList.toggle('is-active', chip.dataset.category === 'Semua'));
      render();
    };
    document.getElementById('reset-search').addEventListener('click', clearSearch);
    document.getElementById('clear-search').addEventListener('click', clearSearch);
  }

  async function setupDetail() {
    const detail = document.getElementById('kost-detail');
    if (!detail) return;

    const notFound = document.getElementById('detail-not-found');
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      notFound.hidden = false;
      return;
    }

    let item;
    try {
      const loaded = await loadListings();
      item = loaded.listings.find((listing) => listing.id === id);
    } catch (error) {
      console.error('Gagal memuat detail kost:', error);
      notFound.hidden = false;
      notFound.querySelector('h1').textContent = 'Data kost belum dapat dimuat';
      notFound.querySelector('p').textContent = 'Jalankan website melalui server lokal agar file data/kos.json dapat dibaca.';
      return;
    }
    if (!item) {
      notFound.hidden = false;
      return;
    }

    detail.hidden = false;
    document.title = `${item.nama_kos} — CekKos.`;
    document.getElementById('breadcrumb-name').textContent = item.nama_kos;
    document.getElementById('detail-type').textContent = `Kost ${item.tipe}`;
    document.getElementById('detail-title').textContent = item.nama_kos;
    document.getElementById('detail-location').textContent = `⌖ ${item.lokasi_singkat}`;
    document.getElementById('detail-price').textContent = formatPrice(item.harga);
    document.getElementById('detail-description').textContent = item.deskripsi;

    const mainImage = document.getElementById('gallery-main');
    const thumbnails = document.getElementById('gallery-thumbnails');
    const gallery = item.galeri_foto.length ? item.galeri_foto : [item.gambar_utama];
    mainImage.src = safeImagePath(item.gambar_utama);
    mainImage.alt = `Foto ${item.nama_kos}`;
    mainImage.addEventListener('error', () => { mainImage.src = FALLBACK_IMAGE; }, { once: true });
    thumbnails.innerHTML = gallery.map((filename, index) => `
      <button class="gallery-thumb ${index === 0 ? 'is-active' : ''}" type="button" aria-label="Lihat foto ${index + 1} ${escapeHtml(item.nama_kos)}">
        <img src="${escapeHtml(safeImagePath(filename))}" alt="" loading="lazy">
      </button>`).join('');
    thumbnails.querySelectorAll('.gallery-thumb').forEach((button, index) => {
      button.addEventListener('click', () => {
        mainImage.src = safeImagePath(gallery[index]);
        mainImage.alt = `Foto ${item.nama_kos}, gambar ${index + 1}`;
        thumbnails.querySelectorAll('.gallery-thumb').forEach((thumbnail) => thumbnail.classList.toggle('is-active', thumbnail === button));
      });
    });

    document.getElementById('facility-list').innerHTML = item.fasilitas.map((facility) => `
      <div class="facility-item"><span class="facility-item-icon" aria-hidden="true">${escapeHtml(FACILITY_ICONS[facility] || '✓')}</span><span>${escapeHtml(facility)}</span></div>`).join('');

    const mapsFallback = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.nama_kos} ${item.lokasi_singkat}`)}`;
    document.getElementById('maps-button').href = safeExternalUrl(item.gmaps_url, mapsFallback);
    const phone = item.wa_number.replace(/\D/g, '');
    const message = `Halo CekKos, saya tertarik ingin menggunakan jasa survey untuk kost ini: ${item.nama_kos}`;
    document.getElementById('survey-button').href = `https://wa.me/${encodeURIComponent(phone || '6281234567890')}?text=${encodeURIComponent(message)}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupMenu();
    setupCatalog();
    setupDetail();
    document.querySelectorAll('#current-year').forEach((element) => { element.textContent = new Date().getFullYear(); });
  });
})();
