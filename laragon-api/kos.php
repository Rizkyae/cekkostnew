<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$dataFile = dirname(__DIR__) . '/data/kos.json';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function cekkos_read_database(string $file): array
{
    if (!is_file($file) || !is_readable($file)) {
        cekkos_json_response(['error' => 'Database data/kos.json tidak ditemukan atau tidak dapat dibaca.'], 500);
    }

    $handle = fopen($file, 'rb');
    if ($handle === false) {
        cekkos_json_response(['error' => 'Database kost gagal dibuka.'], 500);
    }
    if (!flock($handle, LOCK_SH)) {
        fclose($handle);
        cekkos_json_response(['error' => 'Database kost sedang dikunci. Coba kembali.'], 503);
    }

    $contents = stream_get_contents($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    if ($contents === false) {
        cekkos_json_response(['error' => 'Database kost gagal dibaca.'], 500);
    }

    try {
        $records = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        cekkos_json_response(['error' => 'Isi data/kos.json bukan JSON yang valid.'], 500);
    }
    if (!is_array($records) || !array_is_list($records)) {
        cekkos_json_response(['error' => 'Database kost harus berupa array JSON.'], 500);
    }
    return $records;
}

function cekkos_save_database(string $file, array $records): void
{
    $json = json_encode(
        $records,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . PHP_EOL;
    $handle = fopen($file, 'c+b');
    if ($handle === false) {
        cekkos_json_response(['error' => 'Database tidak dapat ditulis. Pastikan folder data dapat ditulis oleh PHP.'], 500);
    }
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        cekkos_json_response(['error' => 'Database sedang digunakan. Coba simpan kembali.'], 503);
    }
    if (!ftruncate($handle, 0) || rewind($handle) === false) {
        flock($handle, LOCK_UN);
        fclose($handle);
        cekkos_json_response(['error' => 'Database gagal disiapkan untuk penulisan.'], 500);
    }

    $written = 0;
    $length = strlen($json);
    while ($written < $length) {
        $result = fwrite($handle, substr($json, $written));
        if ($result === false || $result === 0) {
            flock($handle, LOCK_UN);
            fclose($handle);
            cekkos_json_response(['error' => 'Database gagal disimpan. Periksa izin tulis folder data.'], 500);
        }
        $written += $result;
    }
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
}

function cekkos_validate_image_path(mixed $path): bool
{
    if (!is_string($path) || $path === '' || strlen($path) > 2048 || str_contains($path, '..')) {
        return false;
    }
    if (preg_match('~^https://[^\s"\'<>]+$~i', $path) === 1) {
        return true;
    }
    return preg_match('~^assets/images/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$~i', $path) === 1;
}

function cekkos_validate_records(array $records): array
{
    if (!array_is_list($records) || count($records) > 1000) {
        cekkos_json_response(['error' => 'Data harus berupa daftar kost (maksimal 1000 kost).'], 422);
    }

    $validated = [];
    $seenIds = [];
    $allowedTypes = ['Putra', 'Putri', 'Eksklusif', 'Campur'];

    foreach ($records as $index => $record) {
        if (!is_array($record)) {
            cekkos_json_response(['error' => 'Data kost pada urutan ' . ($index + 1) . ' tidak valid.'], 422);
        }
        $id = trim((string) ($record['id'] ?? ''));
        $name = trim((string) ($record['nama_kos'] ?? ''));
        $location = trim((string) ($record['lokasi_singkat'] ?? ''));
        $type = trim((string) ($record['tipe'] ?? 'Campur'));
        $price = filter_var($record['harga'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $mainImage = $record['gambar_utama'] ?? '';
        $gallery = $record['galeri_foto'] ?? [];
        $facilities = $record['fasilitas'] ?? [];
        $description = trim((string) ($record['deskripsi'] ?? ''));
        $mapsUrl = filter_var($record['gmaps_url'] ?? '', FILTER_VALIDATE_URL);
        $phone = preg_replace('/\D+/', '', (string) ($record['wa_number'] ?? ''));

        if ($id === '' || strlen($id) > 80 || isset($seenIds[$id])) {
            cekkos_json_response(['error' => 'Setiap kost harus memiliki ID unik yang valid.'], 422);
        }
        if ($name === '' || strlen($name) > 300 || $location === '' || strlen($location) > 500) {
            cekkos_json_response(['error' => 'Nama dan lokasi setiap kost wajib diisi.'], 422);
        }
        if ($price === false || !in_array($type, $allowedTypes, true)) {
            cekkos_json_response(['error' => 'Harga atau tipe kost tidak valid: ' . $name], 422);
        }
        if (!cekkos_validate_image_path($mainImage) || !is_array($gallery) || !array_is_list($gallery) || count($gallery) > 30) {
            cekkos_json_response(['error' => 'Path atau daftar galeri foto tidak valid: ' . $name], 422);
        }
        foreach ($gallery as $image) {
            if (!cekkos_validate_image_path($image)) {
                cekkos_json_response(['error' => 'Path gambar galeri tidak valid: ' . $name], 422);
            }
        }
        if (!in_array($mainImage, $gallery, true)) {
            cekkos_json_response(['error' => 'Foto utama harus ada di daftar galeri: ' . $name], 422);
        }
        if (!is_array($facilities) || !array_is_list($facilities) || count($facilities) > 50) {
            cekkos_json_response(['error' => 'Daftar fasilitas tidak valid: ' . $name], 422);
        }
        $facilities = array_values(array_unique(array_filter(
            array_map(static fn ($facility): string => is_string($facility) ? trim($facility) : '', $facilities),
            static fn (string $facility): bool => $facility !== '' && strlen($facility) <= 120
        )));
        if ($description === '' || strlen($description) > 20000 || $mapsUrl === false || !in_array(strtolower((string) parse_url($mapsUrl, PHP_URL_SCHEME)), ['http', 'https'], true)) {
            cekkos_json_response(['error' => 'Deskripsi atau URL Google Maps tidak valid: ' . $name], 422);
        }
        if (strlen($phone) < 9 || strlen($phone) > 15) {
            cekkos_json_response(['error' => 'Nomor WhatsApp harus berisi 9 sampai 15 digit: ' . $name], 422);
        }

        $seenIds[$id] = true;
        $validated[] = [
            'id' => $id,
            'nama_kos' => $name,
            'tipe' => $type,
            'harga' => $price,
            'lokasi_singkat' => $location,
            'gambar_utama' => $mainImage,
            'galeri_foto' => array_values(array_unique($gallery)),
            'fasilitas' => $facilities,
            'deskripsi' => $description,
            'gmaps_url' => $mapsUrl,
            'wa_number' => $phone,
        ];
    }
    return $validated;
}

if ($method === 'GET') {
    if (($_GET['action'] ?? '') === 'session') {
        $authenticated = !empty($_SESSION['cekkos_admin_authenticated']);
        if ($authenticated && empty($_SESSION['cekkos_csrf_token'])) {
            $_SESSION['cekkos_csrf_token'] = bin2hex(random_bytes(32));
        }
        cekkos_json_response([
            'authenticated' => $authenticated,
            'csrf_token' => $authenticated ? $_SESSION['cekkos_csrf_token'] : null,
        ]);
    }
    cekkos_json_response(cekkos_read_database($dataFile));
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    cekkos_json_response(['error' => 'Metode permintaan tidak didukung.'], 405);
}

$payload = cekkos_read_json_body();
$action = (string) ($payload['action'] ?? '');

if ($action === 'login') {
    $config = require __DIR__ . '/config.php';
    if (!$config['credentials_configured']) {
        cekkos_json_response([
            'error' => 'Login admin belum dikonfigurasi. Atur CEKKOS_ADMIN_USERNAME dan CEKKOS_ADMIN_PASSWORD di environment server.',
        ], 503);
    }
    $username = (string) ($payload['username'] ?? '');
    $password = (string) ($payload['password'] ?? '');
    if (!hash_equals($config['admin_username'], $username) || !hash_equals($config['admin_password'], $password)) {
        usleep(350000);
        cekkos_json_response(['error' => 'Username atau password salah.'], 401);
    }

    session_regenerate_id(true);
    $_SESSION['cekkos_admin_authenticated'] = true;
    $_SESSION['cekkos_csrf_token'] = bin2hex(random_bytes(32));
    cekkos_json_response(['authenticated' => true, 'csrf_token' => $_SESSION['cekkos_csrf_token']]);
}

if ($action === 'logout') {
    cekkos_require_admin($payload);
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', [
        'expires' => time() - 42000,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    cekkos_json_response(['authenticated' => false]);
}

if ($action === 'save') {
    cekkos_require_admin($payload);
    if (!isset($payload['data']) || !is_array($payload['data'])) {
        cekkos_json_response(['error' => 'Data kost tidak ditemukan dalam permintaan.'], 400);
    }
    $records = cekkos_validate_records($payload['data']);
    cekkos_save_database($dataFile, $records);
    cekkos_json_response(['success' => true, 'count' => count($records), 'data' => $records]);
}

cekkos_json_response(['error' => 'Aksi API tidak dikenal.'], 400);
