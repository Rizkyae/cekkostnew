<?php
declare(strict_types=1);

$username = getenv('CEKKOS_ADMIN_USERNAME');
$password = getenv('CEKKOS_ADMIN_PASSWORD');
$host = strtolower((string) parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST));
$isLocalHost = in_array($host, ['localhost', '127.0.0.1', '::1'], true)
    || preg_match('/\.(?:test|localhost|local)$/', $host) === 1;

if ($isLocalHost) {
    $username = $username ?: 'admin';
    $password = $password ?: 'admin123';
} else {
    $username = $username ?: '';
    $password = $password ?: '';
}

return [
    'admin_username' => $username,
    'admin_password' => $password,
    'credentials_configured' => $username !== '' && $password !== '',
    'session_name' => 'cekkos_admin_session',
];
