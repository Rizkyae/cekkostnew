# Deploy CekKos ke Vercel

Vercel meng-host HTML/CSS/JavaScript dan endpoint serverless Node.js pada
`api/`. Vercel **tidak menjalankan PHP** pada `api/kos.php`, dan file di sistem
serverless Vercel tidak bisa dijadikan penyimpanan permanen. Karena itu versi
Vercel memakai Vercel Blob sebagai penyimpanan file bersama (bukan database):

- JSON katalog: `cekkos/database/kos.json` di Blob Store.
- Foto upload: `cekkos/images/` di Blob Store, URL foto tersimpan dalam JSON.
- JSON awal yang ada di `data/kos.json` digunakan sampai katalog pertama kali
  disimpan ke Blob Store.

## Langkah konfigurasi Vercel

1. Commit dan push folder proyek ke GitHub, termasuk `api/kos.js`,
   `api/upload.js`, `api/_lib.js`, `package.json`, dan `package-lock.json`.
2. Import/pilih repository di Vercel dan deploy. Folder `api/` otomatis
   menyediakan endpoint `/api/kos` dan `/api/upload`.
3. Di dashboard Vercel, buka **Storage → Create Database → Blob**, buat Blob
   Store, lalu **Connect Project** ke proyek CekKos. Pastikan environment
   `BLOB_READ_WRITE_TOKEN` ditambahkan untuk deployment Production (tambahkan
   juga Preview bila diperlukan).
4. Di **Settings → Environment Variables**, tambahkan:
   - `CEKKOS_ADMIN_USERNAME`: username admin pilihanmu.
   - `CEKKOS_ADMIN_PASSWORD`: password acak yang kuat dan unik.
   - `CEKKOS_SESSION_SECRET`: secret acak minimal 32 karakter. Contoh membuat
     nilai: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
5. Deploy ulang (Redeploy) setelah environment variable dan Blob Store
   dikonfigurasi. Buka `/admin-login.html` pada domain HTTPS yang sama dan
   gunakan username/password dari environment Vercel.
6. Unggah foto dan simpan kost dari dashboard. Semua perangkat yang membuka
   domain deployment yang sama akan membaca katalog dan URL foto Blob yang
   sama.

Jika login sudah berhasil tetapi penyimpanan belum tersambung, pesan API akan
meminta Blob Store dihubungkan. Pastikan token Blob dan variabel environment
tersedia pada environment deployment yang sedang dibuka.

## Migrasi data dari versi localStorage

Jika browser admin menyimpan perubahan dari versi sebelumnya, buka dashboard
di perangkat itu setelah deploy baru. Bila data lama ditemukan, tombol
**Impor data lama dari perangkat ini** akan muncul. Impor mengganti seluruh
katalog bersama. Tinjau datanya dan konfirmasi hanya jika katalog browser
tersebut yang ingin dipertahankan; foto data URL lama turut diunggah ke Blob.

## Pengembangan lokal dengan Laragon

Endpoint PHP `api/kos.php` dan `api/upload.php` tetap tersedia untuk Laragon.
Nama host localhost mengarahkan frontend ke endpoint PHP; domain Vercel
mengarahkan frontend ke serverless API Node.js.

Gunakan HTTPS dan password kuat. JSON adalah file bersama, bukan database
transaksional; hindari menyunting katalog secara bersamaan dari banyak admin.
Atur backup Blob Store secara rutin.
