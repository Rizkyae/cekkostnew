<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';
$isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';

session_name($config['session_name']);
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

function cekkos_json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cekkos_read_json_body(): array
{
    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        cekkos_json_response(['error' => 'Isi permintaan JSON tidak ditemukan.'], 400);
    }

    try {
        $decoded = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        cekkos_json_response(['error' => 'Format JSON tidak valid.'], 400);
    }

    if (!is_array($decoded)) {
        cekkos_json_response(['error' => 'Isi permintaan harus berupa objek JSON.'], 400);
    }
    return $decoded;
}

function cekkos_require_admin(?array $payload = null): void
{
    if (empty($_SESSION['cekkos_admin_authenticated'])) {
        cekkos_json_response(['error' => 'Sesi admin tidak aktif. Silakan login kembali.'], 401);
    }

    $providedToken = $_SERVER['HTTP_X_CEKKOS_CSRF'] ?? ($payload['csrf_token'] ?? '');
    $sessionToken = $_SESSION['cekkos_csrf_token'] ?? '';
    if (!is_string($providedToken) || $sessionToken === '' || !hash_equals($sessionToken, $providedToken)) {
        cekkos_json_response(['error' => 'Token keamanan tidak valid. Muat ulang halaman dan coba kembali.'], 403);
    }
}
