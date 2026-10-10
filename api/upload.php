<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    cekkos_json_response(['error' => 'Metode permintaan tidak didukung.'], 405);
}

cekkos_require_admin();

if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
    cekkos_json_response(['error' => 'File gambar tidak ditemukan pada permintaan.'], 400);
}

$image = $_FILES['image'];
if (($image['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    $uploadErrors = [
        UPLOAD_ERR_INI_SIZE => 'Ukuran gambar melebihi batas upload server.',
        UPLOAD_ERR_FORM_SIZE => 'Ukuran gambar melebihi batas formulir.',
        UPLOAD_ERR_PARTIAL => 'Gambar hanya terunggah sebagian. Coba lagi.',
        UPLOAD_ERR_NO_FILE => 'Pilih gambar terlebih dahulu.',
        UPLOAD_ERR_NO_TMP_DIR => 'Folder upload sementara server tidak tersedia.',
        UPLOAD_ERR_CANT_WRITE => 'Server gagal menyimpan upload sementara.',
        UPLOAD_ERR_EXTENSION => 'Upload gambar diblokir konfigurasi PHP.',
    ];
    cekkos_json_response(['error' => $uploadErrors[$image['error']] ?? 'Upload gambar gagal.'], 422);
}
if (($image['size'] ?? 0) < 1 || $image['size'] > 8 * 1024 * 1024) {
    cekkos_json_response(['error' => 'Ukuran gambar harus kurang dari 8 MB.'], 413);
}

$temporaryFile = (string) ($image['tmp_name'] ?? '');
if (!is_uploaded_file($temporaryFile)) {
    cekkos_json_response(['error' => 'File yang diunggah tidak valid.'], 422);
}

$fileInfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $fileInfo->file($temporaryFile);
$allowedTypes = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
];
if (!is_string($mimeType) || !isset($allowedTypes[$mimeType]) || @getimagesize($temporaryFile) === false) {
    cekkos_json_response(['error' => 'Format gambar yang didukung: JPEG, PNG, atau WebP.'], 415);
}

$uploadDirectory = dirname(__DIR__) . '/assets/images/uploads';
if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0755, true) && !is_dir($uploadDirectory)) {
    cekkos_json_response(['error' => 'Folder upload gambar tidak dapat dibuat. Periksa izin folder assets/images.'], 500);
}
if (!is_writable($uploadDirectory)) {
    cekkos_json_response(['error' => 'Folder assets/images/uploads tidak dapat ditulis oleh PHP.'], 500);
}

try {
    $contentHash = hash_file('sha256', $temporaryFile);
    if (!is_string($contentHash)) {
        cekkos_json_response(['error' => 'Server gagal memverifikasi gambar.'], 500);
    }
    $filename = $contentHash . '.' . $allowedTypes[$mimeType];
} catch (Throwable) {
    cekkos_json_response(['error' => 'Server gagal menyiapkan nama file gambar.'], 500);
}
if (!is_file($uploadDirectory . '/' . $filename) && !move_uploaded_file($temporaryFile, $uploadDirectory . '/' . $filename)) {
    cekkos_json_response(['error' => 'Gambar gagal disimpan di server.'], 500);
}

cekkos_json_response([
    'success' => true,
    'path' => 'assets/images/uploads/' . $filename,
    'mime_type' => $mimeType,
]);
